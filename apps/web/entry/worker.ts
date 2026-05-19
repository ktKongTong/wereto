import { createRRApp } from "../src/app/server";
import { cleanupTimedOutSyncRuns } from "../src/api/sync-cleanup";
import { WereadSyncWorkflow, type WereadSyncWorkflowEnv } from "../src/api/sync-workflow";

export { WereadSyncWorkflow };

const app = createRRApp({
  runtime: "workerd",
  api: {
    adapter: {},
  },
});

export default {
  fetch: app.fetch,
  async scheduled(_controller, env) {
    const cleaned = await cleanupTimedOutSyncRuns(env);
    console.log(`sync cleanup processed ${cleaned} timed out run(s)`);
  },
  queue: () => {}
} satisfies ExportedHandler<WereadSyncWorkflowEnv>;
