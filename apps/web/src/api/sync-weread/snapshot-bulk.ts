import type { AppDb } from "../db/client.ts";
import {
  syncSnapshotAlbums,
  syncSnapshotBooks,
  syncSnapshotShelfItems,
} from "../db/schema.ts";
import { bulkUpsert } from "../db/utils/d1-bulk-writer.ts";
import { pick } from "../db/utils/drizzle-helpers.ts";
import { nowUnix } from "./utils.ts";

export async function stageBookSnapshots(db: AppDb, runId: number, rows: Record<string, unknown>[]) {
  const createdAt = nowUnix();
  const values = rows.map((item) => ({
    runId,
    createdAt,
    ...pick(item, ["wereadBookId", "title", "author", "cover", "intro", "category", "publisher", "isbn", "wordCount", "rating", "ratingCount", "rawJson"]),
  }));
  await bulkUpsert(db, syncSnapshotBooks, [syncSnapshotBooks.runId, syncSnapshotBooks.wereadBookId], values, [
    "title", "author", "cover", "intro", "category", "publisher", "isbn", "word_count", "rating", "rating_count", "raw_json", "created_at",
  ]);
}

export async function stageAlbumSnapshots(db: AppDb, runId: number, rows: Record<string, unknown>[]) {
  const createdAt = nowUnix();
  const values = rows.map((item) => ({
    runId,
    createdAt,
    ...pick(item, ["wereadAlbumId", "name", "authorName", "cover", "trackCount", "finishStatus", "intro", "rawJson"]),
  }));
  await bulkUpsert(db, syncSnapshotAlbums, [syncSnapshotAlbums.runId, syncSnapshotAlbums.wereadAlbumId], values, [
    "name", "author_name", "cover", "track_count", "finish_status", "intro", "raw_json", "created_at",
  ]);
}

export async function stageShelfItemSnapshots(db: AppDb, runId: number, rows: Record<string, unknown>[]) {
  const createdAt = nowUnix();
  const values = rows.map((item) => ({
    runId,
    createdAt,
    ...pick(item, ["entityKey", "itemType", "wereadBookId", "wereadAlbumId", "titleSnapshot", "authorSnapshot", "coverSnapshot", "categorySnapshot", "isTop", "isSecret", "finishReading", "readUpdateTime", "sourceUpdateTime", "rawJson"]),
  }));
  await bulkUpsert(db, syncSnapshotShelfItems, [syncSnapshotShelfItems.runId, syncSnapshotShelfItems.entityKey], values, [
    "item_type", "weread_book_id", "weread_album_id", "title_snapshot", "author_snapshot", "cover_snapshot", "category_snapshot", "is_top", "is_secret", "finish_reading", "read_update_time", "source_update_time", "raw_json", "created_at",
  ]);
}
