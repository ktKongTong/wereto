import { createRRApp } from "@/app/server.ts";
import { cleanupTimedOutSyncRuns } from "@/api/sync-cleanup.ts";
import { consumeWereadSyncQueue } from "@/api/sync-queue.ts";
import { startWereadSyncFromEnv } from "@/api/sync.ts";
import type { WereadSyncWorkerEnv } from "@/api/sync-worker.ts";
export { WereadRateLimiter } from "@/api/do/weread-rate-limiter.ts";
export { SyncRunStateObject } from "@/api/do/sync-run-state.ts";

export default {
  fetch: createRRApp().fetch,
  async scheduled(_controller, env) {
    if(_controller.cron === "*/5 * * * *") {
      const cleaned = await cleanupTimedOutSyncRuns(env);
    }

    if(_controller.cron === "0 20 * * *") {
      const result = await startWereadSyncFromEnv(env, { requireFullSyncCompleted: true });
    }
  },
  queue: consumeWereadSyncQueue,
} satisfies ExportedHandler<WereadSyncWorkerEnv>;
