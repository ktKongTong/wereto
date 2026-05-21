import { createWereadClient, type WereadClient } from "@repo/weread-api";
import pLimit from "p-limit";
import { getDB, type DbEnv } from "./db/client.ts";
import { getConfigValue } from "./db/config.ts";
import { createRepoCtx, type RepoCtx } from "./db/repos/ctx.ts";
import { NOTEBOOKS_LAST_SORT_CURSOR, READING_LAST_FULL_YEAR_CURSOR } from "./db/repos/sync-cursors.repo.ts";
import { SyncRunLogger } from "./sync-logger.ts";
import {
  getBookDetailAndProgress,
  getChangedNotebooks,
  getNotebookContent,
  getReadingDaysForYear,
} from "./sync-weread/fetchers.ts";
import {
  stageBookDetailsAndProgress,
  stageCurrentWeekReadingDays,
  stageNotebookContents,
  stageNotebooks,
  stageReadingDays,
  stageReadingPeriod,
  stageReadingPeriods,
  stageReadingYears,
  stageShelf,
} from "./sync-weread/staging.ts";
import { estimateReadingPeriodCount, formatShanghaiDate, nowUnix, ONE_DAY_SECONDS } from "./sync-weread/utils.ts";

export type SyncStepConfig = {
  retries?: {
    limit: number;
    delay: string | number;
    backoff?: "constant" | "linear" | "exponential";
  };
  timeout?: string | number;
};

export type SyncStepRunner = {
  do<T>(name: string, config: SyncStepConfig, callback: () => Promise<T>): Promise<T>;
};

export const API_STEP = {
  retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
  timeout: "3 minutes",
} satisfies SyncStepConfig;

export const BULK_API_STEP = {
  retries: { limit: 1, delay: "15 seconds", backoff: "exponential" },
  timeout: "15 minutes",
} satisfies SyncStepConfig;

export const DB_STEP = {
  retries: { limit: 1, delay: "2 seconds", backoff: "constant" },
  timeout: "15 minutes",
} satisfies SyncStepConfig;

const WEREAD_CONCURRENCY = 20;

export type WereadSyncRuntime = {
  repos: RepoCtx;
  client: WereadClient;
  runId: number;
  logger: SyncRunLogger;
};

export async function createWereadSyncRuntime(env: DbEnv, runId: number): Promise<WereadSyncRuntime> {
  const db = getDB(env);
  const repos = createRepoCtx(db);
  const apiKey = await getConfigValue(db, "weread.apiKey");
  if (!apiKey) throw new Error("Missing weread.apiKey in app_config");

  const logger = new SyncRunLogger(repos.runs, runId);
  const client = createWereadClient({ apiKey });

  return { repos, client, runId, logger };
}

export async function syncShelf(repos: RepoCtx, client: WereadClient, runId: number, stagedBookIds: Set<string>, logger: SyncRunLogger) {
  await repos.runs.setPhase(runId, "shelf");
  logger.info("shelf", "开始同步书架");
  const shelf = await client.getShelf();
  logger.info("shelf", "书架数据获取完成，开始写入本地快照", { meta: { books: shelf.books?.length ?? 0, albums: shelf.albums?.length ?? 0 } });
  await stageShelf(repos, runId, shelf, stagedBookIds);
  logger.info("shelf", "书架本地快照写入完成", { meta: { books: shelf.books?.length ?? 0, albums: shelf.albums?.length ?? 0 } });
  return { bookCount: shelf.books?.length ?? 0, albumCount: shelf.albums?.length ?? 0 };
}

export async function syncNotebooks(repos: RepoCtx, client: WereadClient, runId: number, stagedBookIds: Set<string>, logger: SyncRunLogger) {
  const checkpoint = await repos.cursors.get(NOTEBOOKS_LAST_SORT_CURSOR);
  const notebooks = await getChangedNotebooks(client, checkpoint ? Number(checkpoint) : null);
  await repos.runs.setPhase(runId, "notebooks", { current: 0, total: notebooks.length });
  logger.info("notebooks", "开始同步笔记本列表", { progressCurrent: 0, progressTotal: notebooks.length, meta: { changed: notebooks.length, checkpoint } });
  await stageNotebooks(repos, runId, notebooks, stagedBookIds);
  if (notebooks[0]?.sort) {
    await repos.cursors.stageSyncCursor(runId, { key: NOTEBOOKS_LAST_SORT_CURSOR, value: String(notebooks[0].sort) });
  }
  logger.info("notebooks", "笔记本列表 snapshot 写入完成", { progressCurrent: notebooks.length, progressTotal: notebooks.length });
  return notebooks;
}

export async function syncReadingPeriods(repos: RepoCtx, client: WereadClient, runId: number, logger: SyncRunLogger, overall: Awaited<ReturnType<WereadClient["getReadData"]>>, runner: SyncStepRunner) {
  const total = estimateReadingPeriodCount(overall.registTime, nowUnix());
  await repos.runs.setPhase(runId, "reading_periods", { current: 0, total });
  logger.info("reading_periods", "开始同步历史阅读周期", { progressTotal: total, meta: { registTime: overall.registTime ?? null } });
  const startTime = overall.registTime ?? Math.floor(Date.UTC(new Date().getFullYear(), 0, 1) / 1000);
  const times: number[] = [];
  for (let time = nowUnix(); time >= startTime; time -= 7 * ONE_DAY_SECONDS) {
    times.push(time);
  }

  await runner.do("reading-periods", BULK_API_STEP, async () => {
    const seenWeeks = new Set<string>();
    const weeklies = [];

    for (const weekly of await fetchWeeklyReadDataBatch(client, times)) {
      if (!weekly.baseTime) continue;
      const weekKey = formatShanghaiDate(weekly.baseTime);
      if (seenWeeks.has(weekKey)) continue;
      seenWeeks.add(weekKey);
      weeklies.push(weekly);
    }

    const stagedBookIds = await repos.catalog.getStagedBookIds(runId);
    await stageReadingPeriods(repos, runId, "weekly", weeklies, stagedBookIds);
    await stageReadingPeriod(repos, runId, "overall", overall, stagedBookIds);
    await repos.runs.setProgress(runId, { current: weeklies.length, total });
    logger.info("reading_periods", `weekly snapshot 已写入 ${weeklies.length}/${total}`, { progressCurrent: weeklies.length, progressTotal: total });
  });
  await repos.runs.setProgress(runId, { current: total, total });
  logger.info("reading_periods", "历史阅读周期 snapshot 写入完成", { progressCurrent: total, progressTotal: total });
}

export async function syncReadingYears(repos: RepoCtx, client: WereadClient, runId: number, stagedBookIds: Set<string>, logger: SyncRunLogger, startYear: number, currentYear: number, runner: SyncStepRunner) {
  const checkpoint = await repos.cursors.get(READING_LAST_FULL_YEAR_CURSOR);
  const total = currentYear - startYear + 1;
  await repos.runs.setPhase(runId, "reading_years", { current: 0, total });
  await runner.do("reading-years", BULK_API_STEP, async () => {
    const skipped = checkpoint ? Math.max(0, Math.min(Number(checkpoint), currentYear - 1) - startYear + 1) : 0;
    if (skipped > 0) await repos.runs.setProgress(runId, { current: skipped, total });

    const years = yearsToSync(startYear, currentYear, checkpoint);
    const annuals = await fetchAnnualReadDataBatch(client, years);
    await stageReadingYears(repos, runId, annuals, stagedBookIds);

    await repos.runs.setProgress(runId, { current: total, total });
    logger.info("reading_years", `年度统计 snapshot 已写入 ${annuals.length}/${total}`, { progressCurrent: total, progressTotal: total });
  });
}

export async function syncReadingDays(repos: RepoCtx, client: WereadClient, runId: number, logger: SyncRunLogger, startYear: number, currentYear: number, runner: SyncStepRunner) {
  const checkpoint = await repos.cursors.get(READING_LAST_FULL_YEAR_CURSOR);
  const total = currentYear - startYear + 1;
  await repos.runs.setPhase(runId, "reading_days", { current: 0, total });
  await runner.do("reading-days", BULK_API_STEP, async () => {
    const skipped = checkpoint ? Math.max(0, Math.min(Number(checkpoint), currentYear - 1) - startYear + 1) : 0;
    if (skipped > 0) await repos.runs.setProgress(runId, { current: skipped, total });

    const yearlyDays = await fetchReadingDaysForYears(client, yearsToSync(startYear, currentYear, checkpoint));
    await stageReadingDays(repos, runId, yearlyDays);

    await repos.runs.setProgress(runId, { current: total, total });
    logger.info("reading_days", `每日阅读 snapshot 已写入 ${yearlyDays.length}/${total}`, { progressCurrent: total, progressTotal: total });
  });
  await repos.cursors.stageSyncCursor(runId, { key: READING_LAST_FULL_YEAR_CURSOR, value: String(currentYear - 1) });
}

export async function syncBookDetails(repos: RepoCtx, client: WereadClient, runId: number, stagedBookIds: Set<string>, logger: SyncRunLogger, runner: SyncStepRunner) {
  const bookIds = Array.from(stagedBookIds);
  await repos.runs.setPhase(runId, "book_details", { current: 0, total: bookIds.length });
  logger.info("book_details", "开始补全书籍详情和阅读进度", { progressCurrent: 0, progressTotal: bookIds.length });
  await runner.do("book-details", BULK_API_STEP, async () => {
    await stageBookDetailsAndProgress(repos, runId, await fetchBookDetailsBatch(client, bookIds));
    await repos.runs.setProgress(runId, { current: bookIds.length, total: bookIds.length });
    logger.info("book_details", `书籍详情 snapshot 已写入 ${bookIds.length}/${bookIds.length}`, { progressCurrent: bookIds.length, progressTotal: bookIds.length });
  });
}

export async function syncNotebookContent(repos: RepoCtx, client: WereadClient, runId: number, notebooks: { bookId: string }[], logger: SyncRunLogger, runner: SyncStepRunner) {
  await repos.runs.setPhase(runId, "highlights_reviews", { current: 0, total: notebooks.length });
  logger.info("highlights_reviews", "开始同步划线和想法", { progressCurrent: 0, progressTotal: notebooks.length });
  await runner.do("highlights-reviews", BULK_API_STEP, async () => {
    await stageNotebookContents(repos, runId, await fetchNotebookContentsBatch(client, notebooks.map((notebook) => notebook.bookId)));
    await repos.runs.setProgress(runId, { current: notebooks.length, total: notebooks.length });
    logger.info("highlights_reviews", `笔记内容 snapshot 已写入 ${notebooks.length}/${notebooks.length}`, {
      progressCurrent: notebooks.length,
      progressTotal: notebooks.length,
    });
  });
}

export async function syncCurrentWeek(repos: RepoCtx, client: WereadClient, runId: number, stagedBookIds: Set<string>, logger: SyncRunLogger, runner: SyncStepRunner) {
  logger.info("bootstrap", "执行增量同步");
  await repos.runs.setPhase(runId, "reading_week", { current: 0, total: 1 });
  const { weekly, stagedDays } = await runner.do("reading-week", BULK_API_STEP, async () => {
    const weekly = await client.getReadData({ mode: "weekly" });
    await stageReadingPeriod(repos, runId, "weekly", weekly, stagedBookIds);
    const stagedDays = await stageCurrentWeekReadingDays(repos, runId, weekly);
    return { weekly, stagedDays };
  });
  logger.info("reading_week", "当前周阅读 snapshot 写入完成", {
    progressCurrent: 1,
    progressTotal: 1,
    meta: { weekStart: weekly.baseTime ? formatShanghaiDate(weekly.baseTime) : null, stagedDays, topBooks: weekly.readLongest?.length ?? 0 },
  });
  return { stagedDays, weekStart: weekly.baseTime ? formatShanghaiDate(weekly.baseTime) : null };
}

async function fetchWeeklyReadDataBatch(client: WereadClient, baseTimes: number[]) {
  const limit = pLimit(WEREAD_CONCURRENCY);
  return Promise.all(baseTimes.map((baseTime) => limit(() => client.getReadData({ mode: "weekly", baseTime }))));
}

async function fetchAnnualReadDataBatch(client: WereadClient, years: number[]) {
  const limit = pLimit(WEREAD_CONCURRENCY);
  return Promise.all(years.map((year) =>
    limit(async () => ({
      year,
      annual: await client.getReadData({ mode: "annually", baseTime: Math.floor(Date.UTC(year, 0, 1) / 1000) }),
    }))
  ));
}

async function fetchReadingDaysForYears(client: WereadClient, years: number[]) {
  const limit = pLimit(WEREAD_CONCURRENCY);
  return Promise.all(years.map((year) => limit(() => getReadingDaysForYear(client, year, limit))));
}

async function fetchBookDetailsBatch(client: WereadClient, bookIds: string[]) {
  const limit = pLimit(WEREAD_CONCURRENCY);
  return Promise.all(bookIds.map((bookId) => limit(() => getBookDetailAndProgress(client, bookId))));
}

async function fetchNotebookContentsBatch(client: WereadClient, bookIds: string[]) {
  const limit = pLimit(WEREAD_CONCURRENCY);
  return Promise.all(bookIds.map((bookId) => limit(() => getNotebookContent(client, bookId))));
}

function yearsToSync(startYear: number, currentYear: number, checkpoint: string | null) {
  const checkpointYear = checkpoint ? Number(checkpoint) : null;
  return Array.from({ length: currentYear - startYear + 1 }, (_, index) => startYear + index).filter((year) => {
    return !(checkpointYear && year < currentYear && year <= checkpointYear);
  });
}
