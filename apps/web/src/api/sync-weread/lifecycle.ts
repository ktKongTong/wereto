import type { RepoCtx } from "../db/repos/ctx.ts";
import { FULL_SYNC_COMPLETED_CURSOR } from "../db/repos/sync-cursors.repo.ts";
import type { JsonRecord } from "../db/schema.ts";
import { SyncRunLogger } from "../sync-logger.ts";
import { nowUnix } from "./utils.ts";

export async function bootstrapRun(repos: RepoCtx, runId: number, logger: SyncRunLogger) {
  await repos.runs.startBootstrap(runId);
  logger.info("bootstrap", "同步任务开始");
  await repos.catalog.clearSnapshots(runId);
  await repos.notebook.clearSnapshots(runId);
  await repos.reading.clearSnapshots(runId);
  await repos.cursors.clearSnapshots(runId);
}

export async function finalizeRun(repos: RepoCtx, runId: number, logger: SyncRunLogger, result: JsonRecord) {
  await repos.runs.setPhase(runId, "commit", { current: 0, total: 1 });
  logger.info("commit", "开始批量提交 snapshot");
  if (result.mode !== "incremental") {
    await repos.cursors.stageSyncCursor(runId, {
      key: FULL_SYNC_COMPLETED_CURSOR,
      value: String(nowUnix()),
    });
  }
  await commitStagedRun(repos, runId);
  await repos.runs.finish(runId, result);
  await clearCommittedSnapshots(repos, runId);
  logger.info("finalize", result.mode === "incremental" ? "增量同步任务完成" : "同步任务完成", { meta: result });
}

async function commitStagedRun(repos: RepoCtx, runId: number) {
  const now = nowUnix();
  const { bookIdMap, albumIdMap } = await repos.catalog.commitSnapshots(runId, now);
  await repos.notebook.commitSnapshots(runId, bookIdMap, now);
  await repos.reading.commitSnapshots(runId, bookIdMap, albumIdMap, now);
  await repos.cursors.commitSnapshots(runId, now);
}

async function clearCommittedSnapshots(repos: RepoCtx, runId: number) {
  await repos.catalog.clearSnapshots(runId);
  await repos.notebook.clearSnapshots(runId);
  await repos.reading.clearSnapshots(runId);
  await repos.cursors.clearSnapshots(runId);
}
