import type { Context } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";

import { getDbForRequest } from "./db/runtime.ts";
import { getSyncRunById } from "./db/queries.ts";
import { syncRuns } from "./db/schema.ts";
import { SyncRunLogger } from "./sync-logger.ts";
import type { WereadSyncWorkflowParams } from "./sync-workflow.ts";

type SyncRequestEnv = {
  DB?: D1Database;
  WEREAD_SYNC_WORKFLOW?: Workflow<WereadSyncWorkflowParams>;
};

export async function startWereadSync(c: Context) {
  const env = c.env as SyncRequestEnv;
  const db = getDbForRequest(env);
  const now = Math.floor(Date.now() / 1000);

  const existing = await db
    .select()
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.taskType, "weread_sync"),
        inArray(syncRuns.status, ["queued", "running"]),
      ),
    )
    .orderBy(desc(syncRuns.requestedAt))
    .limit(1);

  if (existing[0]) {
    return { runId: existing[0].id, deduped: true };
  }

  const [row] = await db
    .insert(syncRuns)
    .values({
      taskType: "weread_sync",
      source: "weread",
      status: "queued",
      phase: "queued",
      requestedAt: now,
      startedAt: now,
      updatedAt: now,
      progressCurrent: 0,
      progressTotal: 0,
      statsJson: "{}",
    })
    .returning();

  if (!row) {
    throw new Error("Failed to create sync task");
  }

  const runId = row.id;
  const logger = new SyncRunLogger(db, runId);
  await logger.info("queued", "同步任务已创建，等待后台执行", {
    progressCurrent: 0,
    progressTotal: 0,
  });

  try {
    if (!env.WEREAD_SYNC_WORKFLOW) {
      throw new Error("Missing WEREAD_SYNC_WORKFLOW binding");
    }

    const instance = await env.WEREAD_SYNC_WORKFLOW.create({
      id: `wereto-sync-${runId}`,
      params: { runId },
    });

    await db
      .update(syncRuns)
      .set({
        workflowInstanceId: instance.id,
        updatedAt: now,
      })
      .where(eq(syncRuns.id, runId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(syncRuns)
      .set({
        status: "failed",
        phase: "workflow",
        finishedAt: now,
        updatedAt: now,
        errorMessage: message,
      })
      .where(eq(syncRuns.id, runId));
    await logger.error("workflow", message);
    throw error;
  }

  return { runId };
}
