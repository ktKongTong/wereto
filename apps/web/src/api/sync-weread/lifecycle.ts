import type { RepoCtx } from "../db/repos/ctx.ts";
import { FULL_SYNC_COMPLETED_CURSOR } from "../db/repos/sync-cursors.repo.ts";
import type { JsonRecord } from "../db/schema.ts";
import { SyncRunLogger } from "../sync-logger.ts";
import { nowUnix } from "./utils.ts";

export async function bootstrapRun(repos: RepoCtx, runId: number, logger: SyncRunLogger) {
  await repos.runs.startBootstrap(runId);
  await logger.phaseStarted("bootstrap", { phaseName: "初始化", taskName: "task", totalTask: 1 });
  await logger.workerStarted("bootstrap", "bootstrap", 1);
  await repos.catalog.clearSnapshots(runId);
  await repos.notebook.clearSnapshots(runId);
  await repos.reading.clearSnapshots(runId);
  await repos.cursors.clearSnapshots(runId);
  await logger.workerDone("bootstrap", "bootstrap", 1, "同步任务初始化完成");
}

export async function finalizeRun(repos: RepoCtx, runId: number, logger: SyncRunLogger, result: JsonRecord) {
  await repos.runs.setPhase(runId, "commit", { current: 0, total: 1 });
  await logger.phaseStarted("commit", { phaseName: "提交", taskName: "commit", totalTask: 1 });
  await logger.workerStarted("commit", "commit", 1);
  if (result.mode !== "incremental") {
    await repos.cursors.stageSyncCursor(runId, {
      key: FULL_SYNC_COMPLETED_CURSOR,
      value: String(nowUnix()),
    });
  }
  await commitStagedRun(repos, runId);
  await logger.workerDone("commit", "commit", 1, "snapshot 批量提交完成");
  await repos.runs.finish(runId, result);
  // await clearCommittedSnapshots(repos, runId);
  await logger.runFinished(result.mode === "incremental" ? "增量同步任务完成" : "同步任务完成", { meta: result });
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
