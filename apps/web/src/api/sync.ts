import type { Context } from "hono";

import { getDB, type DbEnv } from "./db/client.ts";
import { createRepoCtx, type RepoCtx } from "./db/repos/ctx.ts";
import { FULL_SYNC_COMPLETED_CURSOR } from "./db/repos/sync-cursors.repo.ts";
import { createSyncRunLogger } from "./sync-logger.ts";
import type { SyncRunStateEnv } from "./do/sync-run-state.ts";
import {enqueueSyncWork, type WereadSyncDispatchEnv} from "@/api/sync-queue.ts";

type StartSyncEnv = DbEnv & WereadSyncDispatchEnv & SyncRunStateEnv;

type StartSyncOptions = {
  requireFullSyncCompleted?: boolean;
};

export async function startWereadSync(c: Context) {
  return startWereadSyncWithRepos(c.env, c.get("repos"));
}

export async function startWereadSyncFromEnv(env: StartSyncEnv, options: StartSyncOptions = {}) {
  const repos = createRepoCtx(getDB(env));
  return startWereadSyncWithRepos(env, repos, options);
}

async function startWereadSyncWithRepos(env: StartSyncEnv, repos: RepoCtx, options: StartSyncOptions = {}) {
  if (options.requireFullSyncCompleted && !await repos.cursors.get(FULL_SYNC_COMPLETED_CURSOR)) {
    return { skipped: true, reason: "full_sync_required" };
  }

  const existing = await repos.runs.findActiveWereadSyncRun();
  if (existing) {
    return { runId: existing.id, deduped: true };
  }

  const row = await repos.runs.createWereadSyncRun();
  const runId = row.id;
  const logger = createSyncRunLogger(env, runId);
  await logger.info("queue", "同步任务已创建，等待队列执行", {
    meta: { runId },
  });

  try {
    if (!env.WEREAD_SYNC_QUEUE) {
      throw new Error("Missing WEREAD_SYNC_QUEUE binding");
    }

    await enqueueSyncWork(env, { runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await repos.runs.failQueueStart(runId, message);
    await logger.error("queue", message);
    await logger.flush();
    throw error;
  }

  await logger.flush();
  return { runId };
}
