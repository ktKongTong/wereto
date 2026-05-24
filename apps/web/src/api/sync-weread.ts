import { createWereadClient, type WereadClient } from "@repo/weread-api";
import { getDB, type DbEnv } from "./db/client.ts";
import { getConfigValue } from "./db/config.ts";
import { createRepoCtx, type RepoCtx } from "./db/repos/ctx.ts";
import { NOTEBOOKS_LAST_SORT_CURSOR, READING_LAST_FULL_YEAR_CURSOR } from "./db/repos/sync-cursors.repo.ts";
import { createSyncRunLogger, type SyncRunLogger } from "./sync-logger.ts";
import type { SyncRunStateEnv } from "./do/sync-run-state.ts";
import { createWereadRateLimiter, type WereadRateLimiterEnv } from "./do/weread-rate-limiter.ts";
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
import { formatShanghaiDate, nowUnix, ONE_DAY_SECONDS } from "./sync-weread/utils.ts";

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

export const WEEKLY_READ_DATA_BATCH_SIZE = 12;
export const ANNUAL_READ_DATA_BATCH_SIZE = 6;
export const READING_DAYS_YEAR_BATCH_SIZE = 1;
export const BOOK_DETAIL_BATCH_SIZE = 12;
export const NOTEBOOK_CONTENT_BATCH_SIZE = 8;

export type WereadSyncRuntime = {
  repos: RepoCtx;
  client: WereadClient;
  runId: number;
  logger: SyncRunLogger;
};

export async function createWereadSyncRuntime(env: DbEnv & WereadRateLimiterEnv & SyncRunStateEnv, runId: number): Promise<WereadSyncRuntime> {
  const db = getDB(env);
  const repos = createRepoCtx(db);
  const apiKey = await getConfigValue(db, "weread.apiKey");
  if (!apiKey) throw new Error("Missing weread.apiKey in app_config");

  const logger = createSyncRunLogger(env, runId);
  const limiter = createWereadRateLimiter(env);
  const client = createWereadClient({
    apiKey,
    onRequest: () => limiter.acquire(),
  });

  return { repos, client, runId, logger };
}

export async function syncShelf(repos: RepoCtx, client: WereadClient, runId: number, stagedBookIds: Set<string>, logger: SyncRunLogger) {
  await repos.runs.setPhase(runId, "shelf");
  await logger.phaseStarted("shelf", { phaseName: "同步书架", taskName: "shelf", totalTask: 1 });
  await logger.workerStarted("shelf", "shelf", 1);
  const shelf = await client.getShelf();
  await stageShelf(repos, runId, shelf, stagedBookIds);
  await logger.workerDone("shelf", "shelf", 1, "书架本地快照写入完成", {
    meta: { books: shelf.books?.length ?? 0, albums: shelf.albums?.length ?? 0 },
  });
  return { bookCount: shelf.books?.length ?? 0, albumCount: shelf.albums?.length ?? 0 };
}

export async function syncNotebooks(repos: RepoCtx, client: WereadClient, runId: number, stagedBookIds: Set<string>, logger: SyncRunLogger) {
  const checkpoint = await repos.cursors.get(NOTEBOOKS_LAST_SORT_CURSOR);
  const notebooks = await getChangedNotebooks(client, checkpoint ? Number(checkpoint) : null);
  await repos.runs.setPhase(runId, "notebooks", { current: 0, total: notebooks.length });
  await logger.phaseStarted("notebooks", { phaseName: "同步笔记本", taskName: "notebook", totalTask: notebooks.length });
  await logger.workerStarted("notebooks", "notebooks:list", notebooks.length);
  await stageNotebooks(repos, runId, notebooks, stagedBookIds);
  if (notebooks[0]?.sort) {
    await repos.cursors.stageSyncCursor(runId, { key: NOTEBOOKS_LAST_SORT_CURSOR, value: String(notebooks[0].sort) });
  }
  await logger.workerDone("notebooks", "notebooks:list", notebooks.length, "笔记本列表 snapshot 写入完成", {
    meta: { changed: notebooks.length, checkpoint },
  });
  return notebooks;
}

export async function syncReadingPeriods(
  repos: RepoCtx,
  client: WereadClient,
  runId: number,
  logger: SyncRunLogger,
  overall: Awaited<ReturnType<WereadClient["getReadData"]>>,
  runner: SyncStepRunner,
  offset = 0,
  batchSize = WEEKLY_READ_DATA_BATCH_SIZE,
) {
  const startTime = overall.registTime ?? Math.floor(Date.UTC(new Date().getFullYear(), 0, 1) / 1000);
  const times: number[] = [];
  for (let time = nowUnix(); time >= startTime; time -= 7 * ONE_DAY_SECONDS) {
    times.push(time);
  }

  const timesBatch = times.slice(offset, offset + batchSize);
  const weeklies = await runner.do(`reading-periods-${offset}`, BULK_API_STEP, async () => {
    const batch = [];
    for (const weekly of await fetchWeeklyReadDataBatch(client, timesBatch)) {
      if (!weekly.baseTime) continue;
      batch.push(weekly);
    }

    const stagedBookIds = new Set<string>();
    await stageReadingPeriods(repos, runId, "weekly", batch, stagedBookIds);
    return batch;
  });
}

export async function syncReadingOverall(
  repos: RepoCtx,
  runId: number,
  overall: Awaited<ReturnType<WereadClient["getReadData"]>>,
  stagedBookIds: Set<string>,
) {
  await stageReadingPeriod(repos, runId, "overall", overall, stagedBookIds);
}

export async function syncReadingYears(
  repos: RepoCtx,
  client: WereadClient,
  runId: number,
  stagedBookIds: Set<string>,
  logger: SyncRunLogger,
  startYear: number,
  currentYear: number,
  runner: SyncStepRunner,
  offset = 0,
  batchSize = ANNUAL_READ_DATA_BATCH_SIZE,
) {
  const checkpoint = await repos.cursors.get(READING_LAST_FULL_YEAR_CURSOR);
  const years = yearsToSync(startYear, currentYear, checkpoint);
  const yearsBatch = years.slice(offset, offset + batchSize);
  const annuals = await runner.do(`reading-years-${offset}`, BULK_API_STEP, async () => {
    const stagedBookIdsSnapshot = await repos.catalog.getStagedBookIds(runId);
    const batch = await fetchAnnualReadDataBatch(client, yearsBatch);
    await stageReadingYears(repos, runId, batch, stagedBookIdsSnapshot);
    return batch;
  });
}

export async function syncReadingDays(
  repos: RepoCtx,
  client: WereadClient,
  runId: number,
  logger: SyncRunLogger,
  startYear: number,
  currentYear: number,
  runner: SyncStepRunner,
  offset = 0,
  batchSize = READING_DAYS_YEAR_BATCH_SIZE,
) {
  const checkpoint = await repos.cursors.get(READING_LAST_FULL_YEAR_CURSOR);
  const years = yearsToSync(startYear, currentYear, checkpoint);
  const yearsBatch = years.slice(offset, offset + batchSize);
  const yearlyDays = await runner.do(`reading-days-${offset}`, BULK_API_STEP, async () => {
    const batch = await fetchReadingDaysForYears(client, yearsBatch);
    await stageReadingDays(repos, runId, batch);
    return batch;
  });
  if (offset + batchSize >= years.length) {
    await repos.cursors.stageSyncCursor(runId, { key: READING_LAST_FULL_YEAR_CURSOR, value: String(currentYear - 1) });
  }
}

export async function syncBookDetails(
  repos: RepoCtx,
  client: WereadClient,
  runId: number,
  stagedBookIds: Set<string>,
  logger: SyncRunLogger,
  runner: SyncStepRunner,
  offset = 0,
  batchSize = BOOK_DETAIL_BATCH_SIZE,
) {
  const bookIds = Array.from(stagedBookIds);
  const bookIdsBatch = bookIds.slice(offset, offset + batchSize);
  const details = await runner.do(`book-details-${offset}`, BULK_API_STEP, async () => {
    const batch = await fetchBookDetailsBatch(client, bookIdsBatch);
    await stageBookDetailsAndProgress(repos, runId, batch);
    return batch;
  });
}

export async function syncNotebookContent(
  repos: RepoCtx,
  client: WereadClient,
  runId: number,
  notebooks: { bookId: string }[],
  logger: SyncRunLogger,
  runner: SyncStepRunner,
  offset = 0,
  batchSize = NOTEBOOK_CONTENT_BATCH_SIZE,
) {
  const notebooksBatch = notebooks.slice(offset, offset + batchSize);
  const contents = await runner.do(`highlights-reviews-${offset}`, BULK_API_STEP, async () => {
    const batch = await fetchNotebookContentsBatch(client, notebooksBatch.map((notebook) => notebook.bookId));
    await stageNotebookContents(repos, runId, batch);
    return batch;
  });
}

export async function syncCurrentWeek(repos: RepoCtx, client: WereadClient, runId: number, stagedBookIds: Set<string>, logger: SyncRunLogger, runner: SyncStepRunner) {
  await logger.info("bootstrap", "执行增量同步");
  await repos.runs.setPhase(runId, "reading_week", { current: 0, total: 1 });
  await logger.phaseStarted("reading_week", { phaseName: "当前周阅读", taskName: "week", totalTask: 1 });
  await logger.workerStarted("reading_week", "reading-week:current", 1);
  const { weekly, stagedDays } = await runner.do("reading-week", BULK_API_STEP, async () => {
    const weekly = await client.getReadData({ mode: "weekly" });
    await stageReadingPeriod(repos, runId, "weekly", weekly, stagedBookIds);
    const stagedDays = await stageCurrentWeekReadingDays(repos, runId, weekly);
    return { weekly, stagedDays };
  });
  await logger.workerDone("reading_week", "reading-week:current", 1, "当前周阅读 snapshot 写入完成", {
    meta: { weekStart: weekly.baseTime ? formatShanghaiDate(weekly.baseTime) : null, stagedDays, topBooks: weekly.readLongest?.length ?? 0 },
  });
  return { stagedDays, weekStart: weekly.baseTime ? formatShanghaiDate(weekly.baseTime) : null };
}

async function fetchWeeklyReadDataBatch(client: WereadClient, baseTimes: number[]) {
  return Promise.all(baseTimes.map((baseTime) => client.getReadData({ mode: "weekly", baseTime })));
}

async function fetchAnnualReadDataBatch(client: WereadClient, years: number[]) {
  return Promise.all(years.map(async (year) =>
    ({
      year,
      annual: await client.getAnnuallyReadData({ year }),
    })
  ));
}

async function fetchReadingDaysForYears(client: WereadClient, years: number[]) {
  return Promise.all(years.map((year) => getReadingDaysForYear(client, year)));
}

async function fetchBookDetailsBatch(client: WereadClient, bookIds: string[]) {
  return Promise.all(bookIds.map((bookId) => getBookDetailAndProgress(client, bookId)));
}

async function fetchNotebookContentsBatch(client: WereadClient, bookIds: string[]) {
  return Promise.all(bookIds.map((bookId) => getNotebookContent(client, bookId)));
}

function yearsToSync(startYear: number, currentYear: number, checkpoint: string | null) {
  const checkpointYear = checkpoint ? Number(checkpoint) : null;
  return Array.from({ length: currentYear - startYear + 1 }, (_, index) => startYear + index).filter((year) => {
    return !(checkpointYear && year < currentYear && year <= checkpointYear);
  });
}
