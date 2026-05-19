import type { AppDb } from "../db/client.ts";
import { SyncRunLogger } from "../sync-logger.ts";
import { commitStagedRun } from "./commit.ts";
import { clearRunSnapshots, stageSnapshot } from "./snapshots.ts";
import { FULL_SYNC_COMPLETED_CURSOR, updateRun } from "./state.ts";
import { nowUnix, toJson } from "./utils.ts";

export async function bootstrapRun(db: AppDb, runId: number, logger: SyncRunLogger, startedAt: number) {
  await updateRun(db, runId, { status: "running", phase: "bootstrap", startedAt, updatedAt: nowUnix() });
  await logger.info("bootstrap", "同步任务开始");
  await clearRunSnapshots(db, runId);
}

export async function finalizeRun(db: AppDb, runId: number, logger: SyncRunLogger, result: Record<string, unknown>) {
  await updateRun(db, runId, { phase: "commit", progressCurrent: 0, progressTotal: 1, updatedAt: nowUnix() });
  await logger.info("commit", "开始批量提交 snapshot");
  if (result.mode !== "incremental") {
    await stageSnapshot(db, runId, "sync_cursors", FULL_SYNC_COMPLETED_CURSOR, {
      key: FULL_SYNC_COMPLETED_CURSOR,
      value: String(nowUnix()),
    });
  }
  await commitStagedRun(db, runId);
  await updateRun(db, runId, {
    status: "success",
    phase: "finalize",
    finishedAt: nowUnix(),
    updatedAt: nowUnix(),
    resultJson: toJson(result),
  });
  await logger.info("finalize", result.mode === "incremental" ? "增量同步任务完成" : "同步任务完成", { meta: result });
}
