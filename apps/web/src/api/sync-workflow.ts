import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import type { DbEnv } from "./db/client.ts";
import { FULL_SYNC_COMPLETED_CURSOR } from "./db/repos/sync-cursors.repo.ts";
import { bootstrapRun, finalizeRun } from "./sync-weread/lifecycle.ts";
import {
  API_STEP,
  createWereadSyncRuntime,
  DB_STEP,
  syncBookDetails,
  syncCurrentWeek,
  syncNotebookContent,
  syncNotebooks,
  syncReadingDays,
  syncReadingPeriods,
  syncReadingYears,
  syncShelf,
  type SyncStepRunner,
} from "./sync-weread.ts";

export type WereadSyncWorkflowParams = {
  runId: number;
};

export type WereadSyncWorkflowEnv = DbEnv & {
  WEREAD_SYNC_WORKFLOW: Workflow<WereadSyncWorkflowParams>;
};

export class WeretoSyncWorkflow extends WorkflowEntrypoint<WereadSyncWorkflowEnv, WereadSyncWorkflowParams> {
  async run(event: WorkflowEvent<WereadSyncWorkflowParams>, step: WorkflowStep) {
    const runtime = await createWereadSyncRuntime({ DB: this.env.DB }, event.payload.runId);
    const { repos, client, logger } = runtime;
    const runId = runtime.runId;
    const runner = createWorkflowStepRunner(step);

    try {
      await runner.do("bootstrap", DB_STEP, () => bootstrapRun(repos, runId, logger));

      const stagedBookIds = new Set<string>();
      const isIncremental = Boolean(await runner.do("resolve-mode", API_STEP, () => repos.cursors.get(FULL_SYNC_COMPLETED_CURSOR)));
      await runner.do("set-mode", DB_STEP, () => repos.runs.setMode(runId, isIncremental ? "incremental" : "full"));

      if (isIncremental) {
        const week = await syncCurrentWeek(repos, client, runId, stagedBookIds, logger, runner);
        const stagedBookIdsSnapshot = await runner.do("staged-books-after-week", DB_STEP, () => repos.catalog.getStagedBookIds(runId));
        const shelf = await runner.do("shelf", API_STEP, () => syncShelf(repos, client, runId, stagedBookIdsSnapshot, logger));
        const afterShelfBookIds = await runner.do("staged-books-after-shelf", DB_STEP, () => repos.catalog.getStagedBookIds(runId));
        const notebooks = await runner.do("notebooks", API_STEP, () => syncNotebooks(repos, client, runId, afterShelfBookIds, logger));
        const afterNotebookBookIds = await runner.do("staged-books-after-notebooks", DB_STEP, () => repos.catalog.getStagedBookIds(runId));
        await syncBookDetails(repos, client, runId, afterNotebookBookIds, logger, runner);
        await syncNotebookContent(repos, client, runId, notebooks, logger, runner);
        await runner.do("commit", DB_STEP, () => finalizeRun(repos, runId, logger, {
          mode: "incremental",
          shelfBooks: shelf.bookCount,
          shelfAlbums: shelf.albumCount,
          notebookBooks: notebooks.length,
          stagedBooks: afterNotebookBookIds.size,
          stagedDays: week.stagedDays,
          weekStart: week.weekStart,
        }));
        return { runId };
      }

      const shelf = await runner.do("shelf", API_STEP, () => syncShelf(repos, client, runId, stagedBookIds, logger));
      const afterShelfBookIds = await runner.do("staged-books-after-shelf", DB_STEP, () => repos.catalog.getStagedBookIds(runId));

      const notebooks = await runner.do("notebooks", API_STEP, () => syncNotebooks(repos, client, runId, afterShelfBookIds, logger));
      let stagedBookIdsSnapshot = await runner.do("staged-books-after-notebooks", DB_STEP, () => repos.catalog.getStagedBookIds(runId));

      const overall = await runner.do("reading-overall", API_STEP, () => client.getReadData({ mode: "overall" }));
      const currentYear = new Date().getFullYear();
      const startYear = overall.registTime ? new Date(overall.registTime * 1000).getFullYear() : currentYear;

      await syncReadingPeriods(repos, client, runId, logger, overall, runner);
      stagedBookIdsSnapshot = await runner.do("staged-books-after-periods", DB_STEP, () => repos.catalog.getStagedBookIds(runId));

      await syncReadingYears(repos, client, runId, stagedBookIdsSnapshot, logger, startYear, currentYear, runner);
      stagedBookIdsSnapshot = await runner.do("staged-books-after-years", DB_STEP, () => repos.catalog.getStagedBookIds(runId));

      await syncReadingDays(repos, client, runId, logger, startYear, currentYear, runner);
      stagedBookIdsSnapshot = await runner.do("staged-books-after-days", DB_STEP, () => repos.catalog.getStagedBookIds(runId));

      await syncBookDetails(repos, client, runId, stagedBookIdsSnapshot, logger, runner);
      await syncNotebookContent(repos, client, runId, notebooks, logger, runner);
      await runner.do("commit", DB_STEP, () => finalizeRun(repos, runId, logger, {
        shelfBooks: shelf.bookCount,
        shelfAlbums: shelf.albumCount,
        notebookBooks: notebooks.length,
        stagedBooks: stagedBookIdsSnapshot.size,
        startYear,
        currentYear,
      }));
    } catch (error) {
      logger.error("failed", error instanceof Error ? error.message : String(error));
      await repos.runs.fail(runId, { message: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      await logger.flush();
    }

    return { runId };
  }
}

function createWorkflowStepRunner(step: WorkflowStep): SyncStepRunner {
  return {
    do: (name, config, callback) => step.do(name, config as Parameters<WorkflowStep["do"]>[1], callback as never) as Promise<never>,
  };
}
