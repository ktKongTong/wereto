import { getDB, type DbEnv } from "./db/client.ts";
import { createRepoCtx } from "./db/repos/ctx.ts";
import { createSyncRunLogger } from "./sync-logger.ts";
import type { SyncRunStateEnv } from "./do/sync-run-state.ts";
import { nowUnix } from "./time.ts";

export const syncTimeoutSeconds = 15 * 60;

type CleanupEnv = DbEnv & SyncRunStateEnv;

export async function cleanupTimedOutSyncRuns(env: CleanupEnv) {
  const db = getDB(env);
  const repos = createRepoCtx(db);
  const now = nowUnix();
  const staleBefore = now - syncTimeoutSeconds;

  const staleRuns = await repos.runs.findTimedOut(staleBefore);

  for (const run of staleRuns) {
    const logger = createSyncRunLogger(env, run.id);
    const updated = await repos.runs.failTimedOut(run.id, staleBefore);
    if (updated) {
      await logger.error("timeout", "同步任务超过 15 分钟未更新，已自动回收", {
        meta: { progressCurrent: run.progressCurrent, progressTotal: run.progressTotal },
      });
      await logger.runFailed("同步任务超过 15 分钟未更新，已自动回收");
    }
    await logger.flush();
  }

  return staleRuns.length;
}
