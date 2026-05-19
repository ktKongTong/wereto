import { eq } from "drizzle-orm";

import type { AppDb } from "../db/client.ts";
import {
  syncSnapshotAlbums,
  syncSnapshotBookInfo,
  syncSnapshotBookProgress,
  syncSnapshotBooks,
  syncSnapshotCursors,
  syncSnapshotHighlights,
  syncSnapshotNotebookBooks,
  syncSnapshotReadingDays,
  syncSnapshotReadingPeriodBooks,
  syncSnapshotReadingPeriods,
  syncSnapshotReadingTopBooks,
  syncSnapshotReadingYears,
  syncSnapshotReviews,
  syncSnapshotShelfItems,
} from "../db/schema.ts";
import {
  commitAlbums,
  commitBookInfo,
  commitBookProgress,
  commitBooks,
  commitNotebookBooks,
  commitShelfItems,
} from "./commit-books.ts";
import { commitNotebookContent } from "./commit-notes.ts";
import {
  commitCursors,
  commitReadingDays,
  commitReadingPeriods,
  commitReadingYears,
  rebuildReadBooks,
} from "./commit-reading.ts";
import type { DbLike } from "./types.ts";
import { nowUnix } from "./utils.ts";

export async function commitStagedRun(db: AppDb, runId: number) {
  const now = nowUnix();

  const bookIdMap = await commitBooks(db, await rows(db, syncSnapshotBooks, runId), now);
  const albumIdMap = await commitAlbums(db, await rows(db, syncSnapshotAlbums, runId), now);

  await commitShelfItems(db, await rows(db, syncSnapshotShelfItems, runId), bookIdMap, albumIdMap, now);
  await commitNotebookBooks(db, await rows(db, syncSnapshotNotebookBooks, runId), bookIdMap, now);
  await commitBookInfo(db, await rows(db, syncSnapshotBookInfo, runId), bookIdMap, now);
  await commitBookProgress(db, await rows(db, syncSnapshotBookProgress, runId), bookIdMap, now);
  await commitNotebookContent(db, await rows(db, syncSnapshotHighlights, runId), await rows(db, syncSnapshotReviews, runId), bookIdMap, now);
  await commitReadingPeriods(
    db,
    await rows(db, syncSnapshotReadingPeriods, runId),
    await rows(db, syncSnapshotReadingPeriodBooks, runId),
    bookIdMap,
    albumIdMap,
    now,
  );
  await commitReadingYears(
    db,
    await rows(db, syncSnapshotReadingYears, runId),
    await rows(db, syncSnapshotReadingTopBooks, runId),
    bookIdMap,
    albumIdMap,
    now,
  );
  await commitReadingDays(db, await rows(db, syncSnapshotReadingDays, runId), now);
  await rebuildReadBooks(db, now);
  await commitCursors(db, await rows(db, syncSnapshotCursors, runId), now);
}

async function rows(db: DbLike, table: any, runId: number) {
  return db.select().from(table).where(eq(table.runId, runId));
}
