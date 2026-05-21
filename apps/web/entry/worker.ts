import { createRRApp } from "@/app/server.ts";
import { cleanupTimedOutSyncRuns } from "@/api/sync-cleanup.ts";
import { WeretoSyncWorkflow, type WereadSyncWorkflowEnv } from "@/api/sync-workflow.ts";

export { WeretoSyncWorkflow };

export default {
  fetch: createRRApp().fetch,
  async scheduled(_controller, env) {
    if(_controller.cron === "*/5 * * * *") {
      const cleaned = await cleanupTimedOutSyncRuns(env);
      console.log(`sync cleanup processed ${cleaned} timed out run(s)`);
    }

    if(_controller.cron === "0 20 * * *") {
    }
  },
  queue: () => {}
} satisfies ExportedHandler<WereadSyncWorkflowEnv>;
