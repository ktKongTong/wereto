import { getDB, type DbEnv } from "./db/client.ts";
import { createRepoCtx } from "./db/repos/ctx.ts";
import { SyncRunLogger } from "./sync-logger.ts";
import type { WereadSyncWorkflowParams } from "./sync-workflow.ts";
import { nowUnix } from "./time.ts";

export const syncTimeoutSeconds = 15 * 60;

type CleanupEnv = DbEnv & {
  WEREAD_SYNC_WORKFLOW?: Workflow<WereadSyncWorkflowParams>;
};

export async function cleanupTimedOutSyncRuns(env: CleanupEnv) {
  const db = getDB(env);
  const repos = createRepoCtx(db);
  const now = nowUnix();
  const staleBefore = now - syncTimeoutSeconds;

  const staleRuns = await repos.runs.findTimedOut(staleBefore);

  for (const run of staleRuns) {
    const logger = new SyncRunLogger(repos.runs, run.id);
    if (run.workflowInstanceId && env.WEREAD_SYNC_WORKFLOW) {
      await terminateWorkflowInstance(env.WEREAD_SYNC_WORKFLOW, run.workflowInstanceId);
    }
    const updated = await repos.runs.failTimedOut(run.id, staleBefore);
    if (updated) {
      logger.error("timeout", "同步任务超过 15 分钟未更新，已自动回收", {
        progressCurrent: run.progressCurrent,
        progressTotal: run.progressTotal,
      });
    }
    await logger.flush();
  }

  return staleRuns.length;
}

async function terminateWorkflowInstance(workflow: Workflow<WereadSyncWorkflowParams>, instanceId: string) {
  try {
    const instance = await workflow.get(instanceId);
    const status = await instance.status();
    if (status.status === "queued" || status.status === "running" || status.status === "waiting") {
      await instance.terminate();
      return { terminated: true, status: status.status };
    }
    return { terminated: false, status: status.status };
  } catch (error) {
    console.error("Failed to terminate stale weread sync workflow", error);
    return { terminated: false, error: error instanceof Error ? error.message : String(error) };
  }
}
