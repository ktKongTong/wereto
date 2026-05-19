import { and, eq, inArray, lte } from "drizzle-orm";

import { getDb, type DbEnv } from "./db/client.ts";
import { syncRuns } from "./db/schema.ts";
import { SyncRunLogger } from "./sync-logger.ts";

export const syncTimeoutSeconds = 15 * 60;

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

export async function cleanupTimedOutSyncRuns(env: DbEnv) {
  const db = getDb(env);
  const now = nowUnix();
  const staleBefore = now - syncTimeoutSeconds;

  const staleRuns = await db
    .select()
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.status, "running"),
        lte(syncRuns.startedAt, staleBefore),
      ),
    );

  for (const run of staleRuns) {
    await db
      .update(syncRuns)
      .set({
        status: "failed",
        phase: "timeout",
        finishedAt: now,
        updatedAt: now,
        errorMessage: "Sync task timed out after 15 minutes",
      })
      .where(
        and(
          eq(syncRuns.id, run.id),
          inArray(syncRuns.status, ["queued", "running"]),
          lte(syncRuns.updatedAt, staleBefore),
        ),
      );

    await new SyncRunLogger(db, run.id).error("timeout", "同步任务超过 15 分钟未更新，已自动回收", {
      progressCurrent: run.progressCurrent,
      progressTotal: run.progressTotal,
    });
  }

  return staleRuns.length;
}
