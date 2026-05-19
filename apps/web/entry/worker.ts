import { createRRApp } from "../src/app/server";
import { cleanupTimedOutSyncRuns } from "../src/api/sync-cleanup";
import { consumeWereadSyncQueue, type WereadSyncQueueEnv, type WereadSyncQueueMessage } from "../src/api/sync-queue";

const app = createRRApp({
  runtime: "workerd",
  api: {
    adapter: {},
  },
});

export default {
  fetch: app.fetch,
  queue: consumeWereadSyncQueue,
  async scheduled(_controller, env) {
    const cleaned = await cleanupTimedOutSyncRuns(env);
    console.log(`sync cleanup processed ${cleaned} timed out run(s)`);
  },
} satisfies ExportedHandler<WereadSyncQueueEnv, WereadSyncQueueMessage>;
