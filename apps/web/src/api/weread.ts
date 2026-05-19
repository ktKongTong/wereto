import { getArchiveFromDb, getHistoryFromDb, getSyncRunById, listSyncRuns } from "./db/queries";

export { type ArchiveNotebookDetail, type ArchiveReadBook, type ArchiveTimelineItem, type HistoryYearRecord } from "./db/queries";
export type { ShelfAlbumItem, ShelfBookItem } from "./db/queries";

export async function queryHistorySnapshot(env?: { DB?: D1Database }) {
  return getHistoryFromDb(db);
}

export async function queryArchiveSnapshot(env?: { DB?: D1Database }) {
  return getArchiveFromDb(db);
}

export async function querySyncRun(runId: number, env?: { DB?: D1Database }) {
  return getSyncRunById(db, runId);
}

export async function querySyncRuns(env?: { DB?: D1Database }, limit = 20) {
  return listSyncRuns(db, limit);
}
