import { sql } from "drizzle-orm";

import type { AppDb } from "../db/client.ts";
import {
  syncSnapshotAlbums,
  syncSnapshotBooks,
  syncSnapshotShelfItems,
} from "../db/schema.ts";
import { nowUnix, rowParamLimitedChunks } from "./utils.ts";

export async function stageBookSnapshots(db: AppDb, runId: number, rows: Record<string, unknown>[]) {
  const createdAt = nowUnix();
  const values = rows.map((item) => ({
    runId,
    createdAt,
    ...pick(item, ["wereadBookId", "title", "author", "cover", "intro", "category", "publisher", "isbn", "wordCount", "rating", "ratingCount", "rawJson"]),
  }));
  for (const chunk of rowParamLimitedChunks(values)) {
    await upsertMany(db, syncSnapshotBooks, [syncSnapshotBooks.runId, syncSnapshotBooks.wereadBookId], chunk, [
      "title", "author", "cover", "intro", "category", "publisher", "isbn", "word_count", "rating", "rating_count", "raw_json", "created_at",
    ]);
  }
}

export async function stageAlbumSnapshots(db: AppDb, runId: number, rows: Record<string, unknown>[]) {
  const createdAt = nowUnix();
  const values = rows.map((item) => ({
    runId,
    createdAt,
    ...pick(item, ["wereadAlbumId", "name", "authorName", "cover", "trackCount", "finishStatus", "intro", "rawJson"]),
  }));
  for (const chunk of rowParamLimitedChunks(values)) {
    await upsertMany(db, syncSnapshotAlbums, [syncSnapshotAlbums.runId, syncSnapshotAlbums.wereadAlbumId], chunk, [
      "name", "author_name", "cover", "track_count", "finish_status", "intro", "raw_json", "created_at",
    ]);
  }
}

export async function stageShelfItemSnapshots(db: AppDb, runId: number, rows: Record<string, unknown>[]) {
  const createdAt = nowUnix();
  const values = rows.map((item) => ({
    runId,
    createdAt,
    ...pick(item, ["entityKey", "itemType", "wereadBookId", "wereadAlbumId", "titleSnapshot", "authorSnapshot", "coverSnapshot", "categorySnapshot", "isTop", "isSecret", "finishReading", "readUpdateTime", "sourceUpdateTime", "rawJson"]),
  }));
  for (const chunk of rowParamLimitedChunks(values)) {
    await upsertMany(db, syncSnapshotShelfItems, [syncSnapshotShelfItems.runId, syncSnapshotShelfItems.entityKey], chunk, [
      "item_type", "weread_book_id", "weread_album_id", "title_snapshot", "author_snapshot", "cover_snapshot", "category_snapshot", "is_top", "is_secret", "finish_reading", "read_update_time", "source_update_time", "raw_json", "created_at",
    ]);
  }
}

function pick(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, source[key] ?? null]));
}

async function upsertMany(db: AppDb, table: unknown, target: unknown[], values: Record<string, unknown>[], columns: string[]) {
  if (values.length === 0) return;
  await (db as any).insert(table).values(values).onConflictDoUpdate({
    target,
    set: Object.fromEntries(columns.map((column) => [toCamel(column), sql.raw(`excluded.${column}`)])),
  });
}

function toCamel(column: string) {
  return column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
