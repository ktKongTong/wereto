import { createWereadClient, type WereadClient } from "@repo/weread-api";
import { eq } from "drizzle-orm";

import { getDb, type AppDb, type DbEnv } from "./db/client.ts";
import { getConfigValue } from "./db/config.ts";
import { syncSnapshotBooks } from "./db/schema.ts";
import { chunkArray } from "./db/utils/d1-bulk-writer.ts";
import { SyncRunLogger } from "./sync-logger.ts";
import { bootstrapRun, finalizeRun } from "./sync-weread/lifecycle.ts";
import { discardSnapshots, stageSnapshot } from "./sync-weread/snapshots.ts";
import { createRun, FULL_SYNC_COMPLETED_CURSOR, getCursor, updateRun } from "./sync-weread/state.ts";
import { stageBookDetailAndProgress, stageShelf } from "./sync-weread/stage-books.ts";
import { getChangedNotebooks, stageNotebookContent, stageNotebooks } from "./sync-weread/stage-notebooks.ts";
import { stageCurrentWeekReadingDays, stageReadingDaysForYear, stageReadingYear } from "./sync-weread/stage-reading-days.ts";
import { stageReadingPeriod } from "./sync-weread/stage-reading.ts";
import { estimateReadingPeriodCount, formatShanghaiDate, nowUnix, ONE_DAY_SECONDS, toJson } from "./sync-weread/utils.ts";

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

const inlineStepRunner: SyncStepRunner = {
  do: (_name, _config, callback) => callback(),
};

const API_STEP = {
  retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
  timeout: "3 minutes",
} satisfies SyncStepConfig;

const BULK_API_STEP = {
  retries: { limit: 1, delay: "15 seconds", backoff: "exponential" },
  timeout: "5 minutes",
} satisfies SyncStepConfig;

const DB_STEP = {
  retries: { limit: 1, delay: "2 seconds", backoff: "constant" },
  timeout: "2 minutes",
} satisfies SyncStepConfig;

export async function syncWereadToDb(env: DbEnv, runId?: number, runner: SyncStepRunner = inlineStepRunner) {
  const db = getDb(env);
  const apiKey = await getConfigValue(db, "weread.apiKey");
  if (!apiKey) throw new Error("Missing weread.apiKey in app_config");

  const startedAt = nowUnix();
  const activeRunId = runId ?? await createRun(db, startedAt);
  const logger = new SyncRunLogger(db, activeRunId);

  try {
    await runner.do("bootstrap", DB_STEP, () => bootstrapRun(db, activeRunId, logger, startedAt));
    const client = createWereadClient({ apiKey });
    const stagedBookIds = new Set<string>();
    const isIncremental = Boolean(await getCursor(db, FULL_SYNC_COMPLETED_CURSOR));

    await updateRun(db, activeRunId, { statsJson: toJson({ mode: isIncremental ? "incremental" : "full" }), updatedAt: nowUnix() });
    if (isIncremental) {
      await runIncrementalSync(db, client, activeRunId, stagedBookIds, logger, runner);
      return activeRunId;
    }

    await runFullSync(db, client, activeRunId, stagedBookIds, logger, runner);
    return activeRunId;
  } catch (error) {
    discardSnapshots(activeRunId);
    await logger.error("failed", error instanceof Error ? error.message : String(error));
    await updateRun(db, activeRunId, {
      status: "failed",
      finishedAt: nowUnix(),
      updatedAt: nowUnix(),
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function runFullSync(db: AppDb, client: WereadClient, runId: number, stagedBookIds: Set<string>, logger: SyncRunLogger, runner: SyncStepRunner) {
  const shelf = await runner.do("shelf", API_STEP, () => syncShelf(db, client, runId, stagedBookIds, logger));
  stagedBookIds = await getStagedBookIdSet(db, runId);

  const notebooks = await runner.do("notebooks", API_STEP, () => syncNotebooks(db, client, runId, stagedBookIds, logger));
  stagedBookIds = await getStagedBookIdSet(db, runId);

  const overall = await runner.do("reading-overall", API_STEP, () => client.getReadData({ mode: "overall" }));
  const currentYear = new Date().getFullYear();
  const startYear = overall.registTime ? new Date(overall.registTime * 1000).getFullYear() : currentYear;

  await syncReadingPeriods(db, client, runId, logger, overall, runner);
  stagedBookIds = await getStagedBookIdSet(db, runId);

  await syncReadingYears(db, client, runId, stagedBookIds, logger, startYear, currentYear, runner);
  stagedBookIds = await getStagedBookIdSet(db, runId);

  await syncReadingDays(db, client, runId, logger, startYear, currentYear, runner);
  stagedBookIds = await getStagedBookIdSet(db, runId);

  await syncBookDetails(db, client, runId, stagedBookIds, logger, runner);
  await syncNotebookContent(db, client, runId, notebooks, logger, runner);
  await runner.do("commit", DB_STEP, () => finalizeRun(db, runId, logger, {
    shelfBooks: shelf.bookCount,
    shelfAlbums: shelf.albumCount,
    notebookBooks: notebooks.length,
    stagedBooks: stagedBookIds.size,
    startYear,
    currentYear,
  }));
}

async function syncShelf(db: AppDb, client: WereadClient, runId: number, stagedBookIds: Set<string>, logger: SyncRunLogger) {
  await updateRun(db, runId, { phase: "shelf", updatedAt: nowUnix() });
  await logger.info("shelf", "开始同步书架");
  const shelf = await client.getShelf();
  await logger.info("shelf", "书架数据获取完成，开始写入本地快照", { meta: { books: shelf.books?.length ?? 0, albums: shelf.albums?.length ?? 0 } });
  await stageShelf(db, runId, shelf, stagedBookIds);
  await logger.info("shelf", "书架本地快照写入完成", { meta: { books: shelf.books?.length ?? 0, albums: shelf.albums?.length ?? 0 } });
  return { bookCount: shelf.books?.length ?? 0, albumCount: shelf.albums?.length ?? 0 };
}

async function syncNotebooks(db: AppDb, client: WereadClient, runId: number, stagedBookIds: Set<string>, logger: SyncRunLogger) {
  const checkpoint = await getCursor(db, "weread.notebooks.lastSort");
  const notebooks = await getChangedNotebooks(client, checkpoint ? Number(checkpoint) : null);
  await updateRun(db, runId, { phase: "notebooks", progressTotal: notebooks.length, progressCurrent: 0, updatedAt: nowUnix() });
  await logger.info("notebooks", "开始同步笔记本列表", { progressCurrent: 0, progressTotal: notebooks.length, meta: { changed: notebooks.length, checkpoint } });
  await stageNotebooks(db, runId, notebooks, stagedBookIds);
  if (notebooks[0]?.sort) {
    await stageSnapshot(db, runId, "sync_cursors", "weread.notebooks.lastSort", { key: "weread.notebooks.lastSort", value: String(notebooks[0].sort) });
  }
  await logger.info("notebooks", "笔记本列表 snapshot 写入完成", { progressCurrent: notebooks.length, progressTotal: notebooks.length });
  return notebooks;
}

async function syncReadingPeriods(db: AppDb, client: WereadClient, runId: number, logger: SyncRunLogger, overall: Awaited<ReturnType<WereadClient["getReadData"]>>, runner: SyncStepRunner) {
  const total = estimateReadingPeriodCount(overall.registTime, nowUnix());
  await updateRun(db, runId, { phase: "reading_periods", progressCurrent: 0, progressTotal: total, updatedAt: nowUnix() });
  await logger.info("reading_periods", "开始同步历史阅读周期", { progressTotal: total, meta: { registTime: overall.registTime ?? null } });
  const startTime = overall.registTime ?? Math.floor(Date.UTC(new Date().getFullYear(), 0, 1) / 1000);
  const times: number[] = [];
  for (let time = nowUnix(); time >= startTime; time -= 7 * ONE_DAY_SECONDS) {
    times.push(time);
  }

  let progressCurrent = 0;
  for (const [chunkIndex, timesChunk] of chunkArray(times, 12).entries()) {
    const result = await runner.do(`reading-periods-${chunkIndex}`, BULK_API_STEP, async () => {
      const stagedBookIds = await getStagedBookIdSet(db, runId);
      const seenWeeks = new Set<string>();
      let staged = 0;

      for (const time of timesChunk) {
        const weekly = await client.getReadData({ mode: "weekly", baseTime: time });
        if (!weekly.baseTime) continue;
        const weekKey = formatShanghaiDate(weekly.baseTime);
        if (seenWeeks.has(weekKey)) continue;

        seenWeeks.add(weekKey);
        await stageReadingPeriod(db, runId, "weekly", weekly, stagedBookIds);
        staged += 1;
      }

      return { staged };
    });

    progressCurrent += result.staged;
    await updateRun(db, runId, { progressCurrent, progressTotal: total, updatedAt: nowUnix() });
    await logger.info("reading_periods", `weekly snapshot 已写入 ${progressCurrent}/${total}`, { progressCurrent, progressTotal: total });
  }

  await runner.do("reading-periods-overall", API_STEP, async () => {
    const stagedBookIds = await getStagedBookIdSet(db, runId);
    await stageReadingPeriod(db, runId, "overall", overall, stagedBookIds);
  });
  await updateRun(db, runId, { progressCurrent: total, progressTotal: total, updatedAt: nowUnix() });
  await logger.info("reading_periods", "历史阅读周期 snapshot 写入完成", { progressCurrent: total, progressTotal: total });
}

async function syncReadingYears(db: AppDb, client: WereadClient, runId: number, stagedBookIds: Set<string>, logger: SyncRunLogger, startYear: number, currentYear: number, runner: SyncStepRunner) {
  const checkpoint = await getCursor(db, "weread.reading.lastFullYear");
  const total = currentYear - startYear + 1;
  await updateRun(db, runId, { phase: "reading_years", progressCurrent: 0, progressTotal: total, updatedAt: nowUnix() });
  for (let year = startYear; year <= currentYear; year += 1) {
    if (checkpoint && year < currentYear && year <= Number(checkpoint)) {
      await updateRun(db, runId, { progressCurrent: year - startYear + 1, updatedAt: nowUnix() });
      continue;
    }
    await runner.do(`reading-year-${year}`, API_STEP, async () => {
      const annual = await client.getReadData({ mode: "annually", baseTime: Math.floor(Date.UTC(year, 0, 1) / 1000) });
      await stageReadingYear(db, runId, year, annual, stagedBookIds);
    });
    await updateRun(db, runId, { progressCurrent: year - startYear + 1, updatedAt: nowUnix() });
    await logger.info("reading_years", `年度统计 snapshot 已写入 ${year}`, { progressCurrent: year - startYear + 1, progressTotal: total });
  }
}

async function syncReadingDays(db: AppDb, client: WereadClient, runId: number, logger: SyncRunLogger, startYear: number, currentYear: number, runner: SyncStepRunner) {
  const checkpoint = await getCursor(db, "weread.reading.lastFullYear");
  const total = currentYear - startYear + 1;
  await updateRun(db, runId, { phase: "reading_days", progressCurrent: 0, progressTotal: total, updatedAt: nowUnix() });
  for (let year = startYear; year <= currentYear; year += 1) {
    if (checkpoint && year < currentYear && year <= Number(checkpoint)) {
      await updateRun(db, runId, { progressCurrent: year - startYear + 1, updatedAt: nowUnix() });
      continue;
    }
    await runner.do(`reading-days-${year}`, BULK_API_STEP, () => stageReadingDaysForYear(db, client, runId, year));
    await updateRun(db, runId, { progressCurrent: year - startYear + 1, updatedAt: nowUnix() });
    await logger.info("reading_days", `每日阅读 snapshot 已写入 ${year}`, { progressCurrent: year - startYear + 1, progressTotal: total });
  }
  await stageSnapshot(db, runId, "sync_cursors", "weread.reading.lastFullYear", { key: "weread.reading.lastFullYear", value: String(currentYear - 1) });
}

async function syncBookDetails(db: AppDb, client: WereadClient, runId: number, stagedBookIds: Set<string>, logger: SyncRunLogger, runner: SyncStepRunner) {
  const bookIds = Array.from(stagedBookIds);
  await updateRun(db, runId, { phase: "book_details", progressTotal: bookIds.length, progressCurrent: 0, updatedAt: nowUnix() });
  await logger.info("book_details", "开始补全书籍详情和阅读进度", { progressCurrent: 0, progressTotal: bookIds.length });
  let index = 0;
  for (const [chunkIndex, bookIdChunk] of chunkArray(bookIds, 10).entries()) {
    await runner.do(`book-details-${chunkIndex}`, BULK_API_STEP, async () => {
      for (const wereadBookId of bookIdChunk) {
        await stageBookDetailAndProgress(db, client, runId, wereadBookId);
      }
    });

    index += bookIdChunk.length;
    await updateRun(db, runId, { progressCurrent: index, updatedAt: nowUnix() });
    if (index % 20 === 0 || index === bookIds.length) {
      await logger.info("book_details", `书籍详情 snapshot 已写入 ${index}/${bookIds.length}`, { progressCurrent: index, progressTotal: bookIds.length });
    }
  }
}

async function syncNotebookContent(db: AppDb, client: WereadClient, runId: number, notebooks: { bookId: string }[], logger: SyncRunLogger, runner: SyncStepRunner) {
  await updateRun(db, runId, { phase: "highlights_reviews", progressCurrent: 0, progressTotal: notebooks.length, updatedAt: nowUnix() });
  await logger.info("highlights_reviews", "开始同步划线和想法", { progressCurrent: 0, progressTotal: notebooks.length });
  let index = 0;
  for (const [chunkIndex, notebookChunk] of chunkArray(notebooks, 5).entries()) {
    await runner.do(`highlights-reviews-${chunkIndex}`, BULK_API_STEP, async () => {
      for (const notebook of notebookChunk) {
        await stageNotebookContent(db, client, runId, notebook.bookId);
      }
    });

    index += notebookChunk.length;
    await updateRun(db, runId, { progressCurrent: index, updatedAt: nowUnix() });
    if (index % 10 === 0 || index === notebooks.length) {
      await logger.info("highlights_reviews", `笔记内容 snapshot 已写入 ${index}/${notebooks.length}`, {
        progressCurrent: index,
        progressTotal: notebooks.length,
      });
    }
  }
}

async function runIncrementalSync(db: AppDb, client: WereadClient, runId: number, stagedBookIds: Set<string>, logger: SyncRunLogger, runner: SyncStepRunner) {
  await logger.info("bootstrap", "执行增量同步");
  await updateRun(db, runId, { phase: "reading_week", progressCurrent: 0, progressTotal: 1, updatedAt: nowUnix() });
  const weekly = await runner.do("reading-week-current", API_STEP, async () => {
    const weekly = await client.getReadData({ mode: "weekly" });
    await stageReadingPeriod(db, runId, "weekly", weekly, stagedBookIds);
    return weekly;
  });
  const stagedDays = await runner.do("reading-week-days", DB_STEP, () => stageCurrentWeekReadingDays(db, runId, weekly));
  await logger.info("reading_week", "当前周阅读 snapshot 写入完成", {
    progressCurrent: 1,
    progressTotal: 1,
    meta: { weekStart: weekly.baseTime ? formatShanghaiDate(weekly.baseTime) : null, stagedDays, topBooks: weekly.readLongest?.length ?? 0 },
  });
  stagedBookIds = await getStagedBookIdSet(db, runId);
  await syncBookDetails(db, client, runId, stagedBookIds, logger, runner);
  await runner.do("commit", DB_STEP, () => finalizeRun(db, runId, logger, {
    mode: "incremental",
    stagedBooks: stagedBookIds.size,
    stagedDays,
    weekStart: weekly.baseTime ? formatShanghaiDate(weekly.baseTime) : null,
  }));
}

async function getStagedBookIdSet(db: AppDb, runId: number) {
  const rows = await db
    .select({ wereadBookId: syncSnapshotBooks.wereadBookId })
    .from(syncSnapshotBooks)
    .where(eq(syncSnapshotBooks.runId, runId));

  return new Set(rows.map((row) => row.wereadBookId));
}
