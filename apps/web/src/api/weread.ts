import { getDb } from "./db/client.ts";
import { getArchiveFromDb, getHistoryFromDb, getSyncRunById, listSyncRuns } from "./db/queries";

export { type ArchiveNotebookDetail, type ArchiveReadBook, type ArchiveTimelineItem, type HistoryYearRecord } from "./db/queries";
export type { ShelfAlbumItem, ShelfBookItem } from "./db/queries";

export async function queryHistorySnapshot(env?: { DB?: D1Database }) {
  return getHistoryFromDb(getDbBinding(env));
}

export async function queryArchiveSnapshot(env?: { DB?: D1Database }) {
  return getArchiveFromDb(getDbBinding(env));
}

export async function querySyncRun(runId: number, env?: { DB?: D1Database }) {
  return getSyncRunById(getDbBinding(env), runId);
}

export async function querySyncRuns(env?: { DB?: D1Database }, limit = 20) {
  return listSyncRuns(getDbBinding(env), limit);
}

function getDbBinding(env?: { DB?: D1Database }) {
  if (!env?.DB) throw new Error("Missing D1 DB binding");
  return getDb({ DB: env.DB });
}
