import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import type { DbEnv } from "./db/client.ts";
import { syncWereadToDb, type SyncStepRunner } from "./sync-weread.ts";

export type WereadSyncWorkflowParams = {
  runId: number;
};

export type WereadSyncWorkflowEnv = DbEnv & {
  WEREAD_SYNC_WORKFLOW: Workflow<WereadSyncWorkflowParams>;
};

export class WereadSyncWorkflow extends WorkflowEntrypoint<WereadSyncWorkflowEnv, WereadSyncWorkflowParams> {
  async run(event: WorkflowEvent<WereadSyncWorkflowParams>, step: WorkflowStep) {
    const runId = event.payload.runId;
    const runner = createWorkflowStepRunner(step);

    await syncWereadToDb({ DB: this.env.DB }, runId, runner);

    return { runId };
  }
}

function createWorkflowStepRunner(step: WorkflowStep): SyncStepRunner {
  return {
    do: (name, config, callback) => step.do(name, config as Parameters<WorkflowStep["do"]>[1], callback as never) as Promise<never>,
  };
}
