import { and, eq, inArray, lte } from "drizzle-orm";

import { getDb, type DbEnv } from "./db/client.ts";
import { syncRuns } from "./db/schema.ts";
import { SyncRunLogger } from "./sync-logger.ts";
import type { WereadSyncWorkflowParams } from "./sync-workflow.ts";

export const syncTimeoutSeconds = 15 * 60;

type CleanupEnv = DbEnv & {
  WEREAD_SYNC_WORKFLOW?: Workflow<WereadSyncWorkflowParams>;
};

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

export async function cleanupTimedOutSyncRuns(env: CleanupEnv) {
  const db = getDb(env);
  const now = nowUnix();
  const staleBefore = now - syncTimeoutSeconds;

  const staleRuns = await db
    .select()
    .from(syncRuns)
    .where(
      and(
        inArray(syncRuns.status, ["queued", "running"]),
        lte(syncRuns.updatedAt, staleBefore),
      ),
    );

  for (const run of staleRuns) {
    if (run.workflowInstanceId && env.WEREAD_SYNC_WORKFLOW) {
      await terminateWorkflowInstance(env.WEREAD_SYNC_WORKFLOW, run.workflowInstanceId);
    }

    const updated = await db
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
      )
      .returning({ id: syncRuns.id });

    if (updated[0]) {
      await new SyncRunLogger(db, run.id).error("timeout", "同步任务超过 15 分钟未更新，已自动回收", {
        progressCurrent: run.progressCurrent,
        progressTotal: run.progressTotal,
      });
    }
  }

  return staleRuns.length;
}

async function terminateWorkflowInstance(workflow: Workflow<WereadSyncWorkflowParams>, instanceId: string) {
  try {
    const instance = await workflow.get(instanceId);
    const status = await instance.status();
    if (status.status === "queued" || status.status === "running" || status.status === "waiting") {
      await instance.terminate();
    }
  } catch (error) {
    console.error("Failed to terminate stale weread sync workflow", error);
  }
}
