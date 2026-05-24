import type { DbEnv } from "./db/client.ts";
import type { SyncRunPhase } from "./db/repos/sync-runs.repo.ts";
import { FULL_SYNC_COMPLETED_CURSOR } from "./db/repos/sync-cursors.repo.ts";
import { invalidateAllResponseCache, type KvCacheEnv } from "./kv-cache.ts";
import { planInvocationItemCount, planLogicalChunkSize } from "./sync-planner.ts";
import type { WereadSyncQueueMessage, WereadSyncWorkMessage } from "./sync-work.ts";
import { bootstrapRun, finalizeRun } from "./sync-weread/lifecycle.ts";
import {
  createWereadSyncRuntime,
  syncBookDetails,
  syncCurrentWeek,
  syncNotebookContent,
  syncNotebooks,
  syncReadingDays,
  syncReadingOverall,
  syncReadingPeriods,
  syncReadingYears,
  syncShelf,
  type SyncStepRunner, type WereadSyncRuntime,
} from "./sync-weread.ts";
import { nowUnix, ONE_DAY_SECONDS } from "./sync-weread/utils.ts";
import type { SyncRunLogger } from "./sync-logger.ts";
import type { SyncRunStateEnv } from "./do/sync-run-state.ts";
import type { WereadRateLimiterEnv } from "./do/weread-rate-limiter.ts";
import {
  dispatchNextSyncWork,
  dispatchSyncWorks,
  enqueueSyncWork,
  type WereadSyncDispatchEnv
} from "@/api/sync-queue.ts";

export type WereadSyncWorkerEnv = DbEnv & WereadSyncDispatchEnv & WereadRateLimiterEnv & SyncRunStateEnv & KvCacheEnv;

type RepoCtx = Awaited<ReturnType<typeof createWereadSyncRuntime>>["repos"]
type NextParams = Omit<WereadSyncWorkMessage, "runId">;

const directRunner: SyncStepRunner = {
  do: (_name, _config, callback) => callback(),
};

export async function processSyncWork(env: WereadSyncWorkerEnv, payload: WereadSyncQueueMessage) {
  const runtime = await createWereadSyncRuntime(env, payload.runId);
  const { repos, client, logger } = runtime;
  const runId = runtime.runId;
  const stage = payload.stage ?? "bootstrap";

  try {
    if (!await repos.runs.isActive(runId)) return;

    if (stage === "bootstrap") {
      await bootstrapRun(repos, runId, logger);
      const isIncremental = Boolean(await repos.cursors.get(FULL_SYNC_COMPLETED_CURSOR));
      await repos.runs.setMode(runId, isIncremental ? "incremental" : "full");
      await continueWith(repos, env, runId, { stage: isIncremental ? "incremental-week" : "shelf", mode: isIncremental ? "incremental" : "full" });
      return;
    }

    if (stage === "incremental-week") {
      const stagedBookIds = await repos.catalog.getStagedBookIds(runId);
      const week = await syncCurrentWeek(repos, client, runId, stagedBookIds, logger, directRunner);
      await continueWith(repos, env, runId, { stage: "incremental-shelf", mode: "incremental", result: { mode: "incremental", stagedDays: week.stagedDays, weekStart: week.weekStart } });
      return;
    }

    if (stage === "incremental-shelf" || stage === "shelf") {
      const stagedBookIds = await repos.catalog.getStagedBookIds(runId);
      const shelf = await syncShelf(repos, client, runId, stagedBookIds, logger);
      const result = { ...(payload.result ?? {}), shelfBooks: shelf.bookCount, shelfAlbums: shelf.albumCount };
      await continueWith(repos, env, runId, { stage: "notebooks", mode: payload.mode ?? (stage === "incremental-shelf" ? "incremental" : "full"), result });
      return;
    }

    if (stage === "notebooks") {
      const stagedBookIds = await repos.catalog.getStagedBookIds(runId);
      const notebooks = await syncNotebooks(repos, client, runId, stagedBookIds, logger);
      const result = { ...(payload.result ?? {}), notebookBooks: notebooks.length };
      await continueWith(repos, env, runId, payload.mode === "incremental" ? { stage: "book-details", mode: "incremental", offset: 0, result } : { stage: "reading-overall", mode: "full", result });
      return;
    }

    if (stage === "reading-overall") {
      const overall = await client.getReadData({ mode: "overall" });
      const stagedBookIds = await repos.catalog.getStagedBookIds(runId);
      await syncReadingOverall(repos, runId, overall, stagedBookIds);
      const currentYear = new Date().getFullYear();
      const startYear = overall.registTime ? new Date(overall.registTime * 1000).getFullYear() : currentYear;
      await continueWith(repos, env, runId, {
        stage: "reading-periods",
        mode: "full",
        offset: 0,
        overall: { registTime: overall.registTime },
        startYear,
        currentYear,
        result: { ...(payload.result ?? {}), startYear, currentYear },
      });
      return;
    }

    if (stage === "reading-periods") {
      const overall = { registTime: payload.overall?.registTime };
      const total = estimateWeekCount(overall.registTime);
      if (payload.chunkIndex === undefined) {
        await fanOutStage(repos, env, payload, logger, "reading-periods", total);
        return;
      }

      const slice = getInvocationSlice(payload, "reading-periods");
      await syncReadingPeriods(repos, client, runId, logger, overall, directRunner, slice.offset, slice.size);
      if (await continueChunkIfNeeded(repos, env, payload, slice)) return;
      if (await completeChunkAndIsStageDone(repos, logger, payload, "reading-periods")) {
        await continueWith(repos, env, runId, resetChunk(payload, "reading-years"));
      }
      return;
    }

    if (stage === "reading-years") {
      const startYear = payload.startYear ?? new Date().getFullYear();
      const currentYear = payload.currentYear ?? new Date().getFullYear();
      const years = yearsToSync(startYear, currentYear, null);
      const stagedBookIds = await repos.catalog.getStagedBookIds(runId);
      if (payload.chunkIndex === undefined) {
        await fanOutStage(repos, env, payload, logger, "reading-years", years.length);
        return;
      }

      const slice = getInvocationSlice(payload, "reading-years");
      await syncReadingYears(repos, client, runId, stagedBookIds, logger, startYear, currentYear, directRunner, slice.offset, slice.size);
      if (await continueChunkIfNeeded(repos, env, payload, slice)) return;
      if (await completeChunkAndIsStageDone(repos, logger, payload, "reading-years")) {
        await continueWith(repos, env, runId, resetChunk(payload, "reading-days"));
      }
      return;
    }

    if (stage === "reading-days") {
      const startYear = payload.startYear ?? new Date().getFullYear();
      const currentYear = payload.currentYear ?? new Date().getFullYear();
      const years = yearsToSync(startYear, currentYear, null);
      if (payload.chunkIndex === undefined) {
        await fanOutStage(repos, env, payload, logger, "reading-days", years.length);
        return;
      }

      const slice = getInvocationSlice(payload, "reading-days");
      await syncReadingDays(repos, client, runId, logger, startYear, currentYear, directRunner, slice.offset, slice.size);
      if (await continueChunkIfNeeded(repos, env, payload, slice)) return;
      if (await completeChunkAndIsStageDone(repos, logger, payload, "reading-days")) {
        await continueWith(repos, env, runId, resetChunk(payload, "book-details"));
      }
      return;
    }

    if (stage === "book-details") {
      const bookIds = Array.from(await repos.catalog.getStagedBookIds(runId));
      if (payload.chunkIndex === undefined) {
        await fanOutStage(repos, env, { ...payload, result: { ...(payload.result ?? {}), stagedBooks: bookIds.length } }, logger, "book-details", bookIds.length);
        return;
      }

      const slice = getInvocationSlice(payload, "book-details");
      await syncBookDetails(repos, client, runId, new Set(bookIds), logger, directRunner, slice.offset, slice.size);
      if (await continueChunkIfNeeded(repos, env, payload, slice)) return;
      if (await completeChunkAndIsStageDone(repos, logger, payload, "book-details")) {
        await continueWith(repos, env, runId, resetChunk(payload, "notebook-content"));
      }
      return;
    }

    if (stage === "notebook-content") {
      const bookIds = await repos.notebook.listStagedNotebookBookIds(runId);
      if (payload.chunkIndex === undefined) {
        await fanOutStage(repos, env, payload, logger, "notebook-content", bookIds.length);
        return;
      }

      const slice = getInvocationSlice(payload, "notebook-content");
      await syncNotebookContent(repos, client, runId, bookIds.map((bookId) => ({ bookId })), logger, directRunner, slice.offset, slice.size);
      if (await continueChunkIfNeeded(repos, env, payload, slice)) return;
      if (await completeChunkAndIsStageDone(repos, logger, payload, "notebook-content")) {
        await continueWith(repos, env, runId, resetChunk(payload, "commit"));
      }
      return;
    }

    if (stage === "commit") {
      if (await repos.runs.isActive(runId)) {
        await finalizeRun(repos, runId, logger, payload.result ?? {});
        await invalidateAllResponseCache(env);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logger.error("failed", message);
    await logger.runFailed(message);
    if (payload.chunkIndex !== undefined) {
      await repos.stageChunks.failChunk({ runId, stage, chunkIndex: payload.chunkIndex, error: message });
      await logger.workerFailed(phaseToRunPhase(stage), `chunk:${stage}:${payload.chunkIndex}`, payload.chunkSize ?? 1, message);
    }
    await repos.runs.fail(runId, { message });
    throw error;
  } finally {
    await logger.flush();
  }
}

async function continueWith(repos: RepoCtx, env: WereadSyncWorkerEnv, runId: number, params: NextParams) {
  if (!await repos.runs.isActive(runId)) return;
  await dispatchNextSyncWork(repos, env, { runId, ...params });
}

async function fanOutStage(
  repos: RepoCtx,
  env: WereadSyncWorkerEnv,
  payload: WereadSyncQueueMessage,
  logger: SyncRunLogger,
  stage: NonNullable<WereadSyncQueueMessage["stage"]>,
  total: number,
) {
  if (total === 0) {
    await continueWith(repos, env, payload.runId, nextStageAfter(stage, payload));
    return;
  }

  if (!await repos.runs.isActive(payload.runId)) return;
  await repos.runs.setPhase(payload.runId, phaseToRunPhase(stage), { current: 0, total });
  const batchSize = planLogicalChunkSize(stage);
  const chunks = Array.from({ length: Math.ceil(total / batchSize) }, (_, chunkIndex) => ({
    runId: payload.runId,
    stage,
    chunkIndex,
    offset: chunkIndex * batchSize,
    size: Math.min(batchSize, total - chunkIndex * batchSize),
  }));
  const phaseId = phaseToRunPhase(stage);
  await logger.phaseStarted(phaseId, {
    phaseName: phaseStartLabel(stage),
    taskName: phaseTaskName(stage),
    totalTask: total,
    totalWorkers: chunks.length,
  });
  await Promise.all(chunks.map((chunk) => logger.workerStarted(phaseId, `chunk:${stage}:${chunk.chunkIndex}`, chunk.size)));

  await repos.stageChunks.ensureChunks(chunks);
  await dispatchSyncWorks(repos, env, payload.runId, chunks.map((chunk) => ({
    ...payload,
    stage,
    offset: chunk.offset,
    chunkIndex: chunk.chunkIndex,
    chunkSize: chunk.size,
    chunkEnd: chunk.offset + chunk.size,
  })));
}

type InvocationSlice = {
  offset: number;
  size: number;
  nextOffset: number;
  chunkEnd: number;
};

function getInvocationSlice(payload: WereadSyncQueueMessage, stage: NonNullable<WereadSyncQueueMessage["stage"]>): InvocationSlice {
  const offset = payload.offset ?? 0;
  const chunkEnd = payload.chunkEnd ?? offset + (payload.chunkSize ?? planLogicalChunkSize(stage));
  const remaining = Math.max(0, chunkEnd - offset);
  const size = planInvocationItemCount(stage, remaining);
  return {
    offset,
    size,
    nextOffset: Math.min(chunkEnd, offset + size),
    chunkEnd,
  };
}

async function continueChunkIfNeeded(
  repos: Awaited<ReturnType<typeof createWereadSyncRuntime>>["repos"],
  env: WereadSyncWorkerEnv,
  payload: WereadSyncQueueMessage,
  slice: InvocationSlice,
) {
  if (slice.nextOffset >= slice.chunkEnd) return false;
  if (!await repos.runs.isActive(payload.runId)) return true;
  await enqueueSyncWork(env, {
    ...payload,
    offset: slice.nextOffset,
    chunkSize: slice.chunkEnd - slice.nextOffset,
    chunkEnd: slice.chunkEnd,
  });
  return true;
}

function phaseToRunPhase(stage: NonNullable<WereadSyncQueueMessage["stage"]>): SyncRunPhase {
  if (stage === "reading-periods") return "reading_periods";
  if (stage === "reading-years") return "reading_years";
  if (stage === "reading-days") return "reading_days";
  if (stage === "book-details") return "book_details";
  if (stage === "notebook-content") return "highlights_reviews";
  if (stage === "incremental-week") return "reading_week";
  if (stage === "incremental-shelf") return "shelf";
  if (stage === "reading-overall") return "reading_periods";
  if (stage === "commit") return "commit";
  return stage;
}

async function completeChunkAndIsStageDone(
  repos: Awaited<ReturnType<typeof createWereadSyncRuntime>>["repos"],
  logger: SyncRunLogger,
  payload: WereadSyncQueueMessage,
  stage: NonNullable<WereadSyncQueueMessage["stage"]>,
) {
  if (payload.chunkIndex === undefined) return false;
  if (!await repos.runs.isActive(payload.runId)) return false;
  const completedChunk = await repos.stageChunks.completeChunk({ runId: payload.runId, stage, chunkIndex: payload.chunkIndex });
  if (completedChunk) {
    await logger.workerDone(phaseToRunPhase(stage), `chunk:${stage}:${payload.chunkIndex}`, completedChunk.size, phaseProgressMessage(stage));
  }
  const progress = await repos.stageChunks.getProgress(payload.runId, stage);
  if (progress.total === 0 || progress.done < progress.total) return false;
  if (!await repos.runs.isActive(payload.runId)) return false;
  return Boolean(await repos.stageChunks.claimStageAdvance(payload.runId, stage));
}

function phaseStartLabel(stage: NonNullable<WereadSyncQueueMessage["stage"]>) {
  if (stage === "reading-periods") return "同步历史阅读周期";
  if (stage === "reading-years") return "同步年度统计";
  if (stage === "reading-days") return "同步每日阅读";
  if (stage === "book-details") return "补全书籍详情";
  if (stage === "notebook-content") return "同步划线和想法";
  return "阶段开始";
}

function phaseProgressMessage(stage: NonNullable<WereadSyncQueueMessage["stage"]>) {
  if (stage === "reading-periods") return "weekly snapshot 已写入";
  if (stage === "reading-years") return "年度统计 snapshot 已写入";
  if (stage === "reading-days") return "每日阅读 snapshot 已写入";
  if (stage === "book-details") return "书籍详情 snapshot 已写入";
  if (stage === "notebook-content") return "笔记内容 snapshot 已写入";
  return "snapshot 已写入";
}

function phaseTaskName(stage: NonNullable<WereadSyncQueueMessage["stage"]>) {
  if (stage === "reading-periods") return "weekly";
  if (stage === "reading-years") return "year";
  if (stage === "reading-days") return "day";
  if (stage === "book-details") return "book";
  if (stage === "notebook-content") return "notebook";
  return "task";
}

function nextStageAfter(stage: NonNullable<WereadSyncQueueMessage["stage"]>, payload: WereadSyncQueueMessage): NextParams {
  if (stage === "reading-periods") return resetChunk(payload, "reading-years");
  if (stage === "reading-years") return resetChunk(payload, "reading-days");
  if (stage === "reading-days") return resetChunk(payload, "book-details");
  if (stage === "book-details") return resetChunk(payload, "notebook-content");
  if (stage === "notebook-content") return resetChunk(payload, "commit");
  return resetChunk(payload, "commit");
}

function resetChunk(payload: WereadSyncQueueMessage, stage: NonNullable<WereadSyncQueueMessage["stage"]>): NextParams {
  return {
    ...payload,
    stage,
    offset: 0,
    chunkIndex: undefined,
    chunkSize: undefined,
    chunkEnd: undefined,
  };
}

function estimateWeekCount(registTime: number | undefined) {
  const startTime = registTime ?? Math.floor(Date.UTC(new Date().getFullYear(), 0, 1) / 1000);
  return Math.floor((nowUnix() - startTime) / (7 * ONE_DAY_SECONDS)) + 1;
}

function yearsToSync(startYear: number, currentYear: number, checkpoint: string | null) {
  const checkpointYear = checkpoint ? Number(checkpoint) : null;
  return Array.from({ length: currentYear - startYear + 1 }, (_, index) => startYear + index).filter((year) => {
    return !(checkpointYear && year < currentYear && year <= checkpointYear);
  });
}
