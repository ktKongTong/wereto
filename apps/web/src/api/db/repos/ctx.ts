import type { DB } from "../client.ts";
import { ApiKeysRepo } from "./api-keys.repo.ts";
import { CatalogRepo } from "./catalog.repo.ts";
import { NotebookRepo } from "./notebook.repo.ts";
import { ReadingRepo } from "./reading.repo.ts";
import { SyncCursorsRepo } from "./sync-cursors.repo.ts";
import { SyncRunsRepo } from "./sync-runs.repo.ts";
import { SyncStageChunksRepo } from "./sync-stage-chunks.repo.ts";

export type RepoCtx = ReturnType<typeof createRepoCtx>;

export function createRepoCtx(db: DB) {
  return {
    apiKeys: new ApiKeysRepo(db),
    catalog: new CatalogRepo(db),
    notebook: new NotebookRepo(db),
    reading: new ReadingRepo(db),
    cursors: new SyncCursorsRepo(db),
    runs: new SyncRunsRepo(db),
    stageChunks: new SyncStageChunksRepo(db),
  };
}
