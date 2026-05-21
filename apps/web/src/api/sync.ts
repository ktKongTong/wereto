import type { Context } from "hono";

import { SyncRunLogger } from "./sync-logger.ts";

export async function startWereadSync(c: Context) {
  const repos = c.get("repos");
  const existing = await repos.runs.findActiveWereadSyncRun();
  if (existing) {
    return { runId: existing.id, deduped: true };
  }

  const row = await repos.runs.createWereadSyncRun();
  const runId = row.id;
  const logger = new SyncRunLogger(repos.runs, runId);
  logger.info("workflow", "同步任务已创建，等待 Workflow 执行", {
    progressCurrent: 0,
    progressTotal: 0,
  });

  try {
    if (!c.env.WEREAD_SYNC_WORKFLOW) {
      throw new Error("Missing WEREAD_SYNC_WORKFLOW binding");
    }

    const instance = await c.env.WEREAD_SYNC_WORKFLOW.create({
      id: `wereto-sync-${runId}`,
      params: { runId },
    });

    await repos.runs.attachWorkflowInstance(runId, instance.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await repos.runs.failWorkflowStart(runId, message);
    logger.error("workflow", message);
    await logger.flush();
    throw error;
  }

  await logger.flush();
  return { runId };
}
