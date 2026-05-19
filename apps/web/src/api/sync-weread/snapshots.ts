import { eq, sql } from "drizzle-orm";

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
import type { SnapshotTarget } from "./types.ts";
import { nowUnix, rowParamLimitedChunks } from "./utils.ts";

const snapshotTables = [
  syncSnapshotBooks,
  syncSnapshotAlbums,
  syncSnapshotShelfItems,
  syncSnapshotNotebookBooks,
  syncSnapshotBookInfo,
  syncSnapshotBookProgress,
  syncSnapshotHighlights,
  syncSnapshotReviews,
  syncSnapshotReadingPeriods,
  syncSnapshotReadingPeriodBooks,
  syncSnapshotReadingYears,
  syncSnapshotReadingTopBooks,
  syncSnapshotReadingDays,
  syncSnapshotCursors,
] as const;

export async function clearRunSnapshots(db: AppDb, runId: number) {
  for (const table of snapshotTables) {
    await db.delete(table).where(eq(table.runId, runId));
  }
}

export async function stageSnapshot(db: AppDb, runId: number, targetTable: SnapshotTarget, entityKey: string, payload: unknown) {
  const item = payload as Record<string, unknown>;
  const createdAt = nowUnix();

  switch (targetTable) {
    case "books":
      return upsert(db, syncSnapshotBooks, [syncSnapshotBooks.runId, syncSnapshotBooks.wereadBookId], {
        runId, createdAt, ...pick(item, ["wereadBookId", "title", "author", "cover", "intro", "category", "publisher", "isbn", "wordCount", "rating", "ratingCount", "rawJson"]),
      }, ["title", "author", "cover", "intro", "category", "publisher", "isbn", "word_count", "rating", "rating_count", "raw_json", "created_at"]);
    case "albums":
      return upsert(db, syncSnapshotAlbums, [syncSnapshotAlbums.runId, syncSnapshotAlbums.wereadAlbumId], {
        runId, createdAt, ...pick(item, ["wereadAlbumId", "name", "authorName", "cover", "trackCount", "finishStatus", "intro", "rawJson"]),
      }, ["name", "author_name", "cover", "track_count", "finish_status", "intro", "raw_json", "created_at"]);
    case "shelf_items":
      return upsert(db, syncSnapshotShelfItems, [syncSnapshotShelfItems.runId, syncSnapshotShelfItems.entityKey], {
        runId, createdAt, entityKey, ...pick(item, ["itemType", "wereadBookId", "wereadAlbumId", "titleSnapshot", "authorSnapshot", "coverSnapshot", "categorySnapshot", "isTop", "isSecret", "finishReading", "readUpdateTime", "sourceUpdateTime", "rawJson"]),
      }, ["item_type", "weread_book_id", "weread_album_id", "title_snapshot", "author_snapshot", "cover_snapshot", "category_snapshot", "is_top", "is_secret", "finish_reading", "read_update_time", "source_update_time", "raw_json", "created_at"]);
    case "notebook_books":
      return upsert(db, syncSnapshotNotebookBooks, [syncSnapshotNotebookBooks.runId, syncSnapshotNotebookBooks.wereadBookId], {
        runId, createdAt, ...pick(item, ["wereadBookId", "reviewCount", "noteCount", "bookmarkCount", "totalCount", "readingProgress", "markedStatus", "sort", "rawJson"]),
      }, ["review_count", "note_count", "bookmark_count", "total_count", "reading_progress", "marked_status", "sort", "raw_json", "created_at"]);
    case "book_info":
      return upsert(db, syncSnapshotBookInfo, [syncSnapshotBookInfo.runId, syncSnapshotBookInfo.wereadBookId], {
        runId, createdAt, ...pick(item, ["wereadBookId", "title", "author", "translator", "cover", "intro", "category", "publisher", "publishTime", "isbn", "wordCount", "rating", "ratingCount", "ratingDetailJson", "rawJson"]),
      }, ["title", "author", "translator", "cover", "intro", "category", "publisher", "publish_time", "isbn", "word_count", "rating", "rating_count", "rating_detail_json", "raw_json", "created_at"]);
    case "book_progress":
      return upsert(db, syncSnapshotBookProgress, [syncSnapshotBookProgress.runId, syncSnapshotBookProgress.wereadBookId], {
        runId, createdAt, ...pick(item, ["wereadBookId", "chapterUid", "chapterOffset", "progress", "recordReadingTime", "finishTime", "isStartReading", "sourceUpdateTime", "sourceTimestamp", "rawJson"]),
      }, ["chapter_uid", "chapter_offset", "progress", "record_reading_time", "finish_time", "is_start_reading", "source_update_time", "source_timestamp", "raw_json", "created_at"]);
    case "highlights":
      return upsert(db, syncSnapshotHighlights, [syncSnapshotHighlights.runId, syncSnapshotHighlights.wereadBookmarkId], {
        runId, createdAt, ...pick(item, ["wereadBookId", "wereadBookmarkId", "chapterUid", "chapterTitle", "range", "markText", "colorStyle", "createTime", "rawJson"]),
      }, ["weread_book_id", "chapter_uid", "chapter_title", "range", "mark_text", "color_style", "create_time", "raw_json", "created_at"]);
    case "reviews":
      return upsert(db, syncSnapshotReviews, [syncSnapshotReviews.runId, syncSnapshotReviews.wereadReviewId], {
        runId, createdAt, ...pick(item, ["wereadBookId", "wereadReviewId", "chapterUid", "chapterName", "range", "abstract", "content", "star", "isFinish", "reviewType", "createTime", "rawJson"]),
      }, ["weread_book_id", "chapter_uid", "chapter_name", "range", "abstract", "content", "star", "is_finish", "review_type", "create_time", "raw_json", "created_at"]);
    case "reading_periods":
      return upsert(db, syncSnapshotReadingPeriods, [syncSnapshotReadingPeriods.runId, syncSnapshotReadingPeriods.periodType, syncSnapshotReadingPeriods.periodStart], {
        runId, createdAt, ...pick(item, ["periodType", "periodStart", "periodEnd", "baseTime", "totalReadTime", "readDays", "dayAverageReadTime", "compare", "readTimesJson", "readStatJson", "rawJson"]),
      }, ["period_end", "base_time", "total_read_time", "read_days", "day_average_read_time", "compare_basis_points", "read_times_json", "read_stat_json", "raw_json", "created_at"]);
    case "reading_period_books":
      return upsert(db, syncSnapshotReadingPeriodBooks, [syncSnapshotReadingPeriodBooks.runId, syncSnapshotReadingPeriodBooks.periodKey, syncSnapshotReadingPeriodBooks.rank], {
        runId, createdAt, ...pick(item, ["periodKey", "wereadBookId", "wereadAlbumId", "rank", "readTime", "recordReadingTime", "tagsJson", "titleSnapshot", "authorSnapshot", "coverSnapshot", "rawJson"]),
      }, ["weread_book_id", "weread_album_id", "read_time", "record_reading_time", "tags_json", "title_snapshot", "author_snapshot", "cover_snapshot", "raw_json", "created_at"]);
    case "reading_years":
      return upsert(db, syncSnapshotReadingYears, [syncSnapshotReadingYears.runId, syncSnapshotReadingYears.year], {
        runId, createdAt, ...pick(item, ["year", "totalReadTime", "readDays", "dayAverageReadTime", "compare", "rawJson"]),
      }, ["total_read_time", "read_days", "day_average_read_time", "compare_basis_points", "raw_json", "created_at"]);
    case "reading_top_books":
      return upsert(db, syncSnapshotReadingTopBooks, [syncSnapshotReadingTopBooks.runId, syncSnapshotReadingTopBooks.year, syncSnapshotReadingTopBooks.rank], {
        runId, createdAt, ...pick(item, ["year", "wereadBookId", "wereadAlbumId", "rank", "readTime", "recordReadingTime", "tagsJson", "titleSnapshot", "authorSnapshot", "coverSnapshot"]),
      }, ["weread_book_id", "weread_album_id", "read_time", "record_reading_time", "tags_json", "title_snapshot", "author_snapshot", "cover_snapshot", "created_at"]);
    case "reading_days":
      return upsert(db, syncSnapshotReadingDays, [syncSnapshotReadingDays.runId, syncSnapshotReadingDays.year, syncSnapshotReadingDays.day], {
        runId, createdAt, ...pick(item, ["year", "day", "readSeconds", "source"]),
      }, ["read_seconds", "source", "created_at"]);
    case "sync_cursors":
      return upsert(db, syncSnapshotCursors, [syncSnapshotCursors.runId, syncSnapshotCursors.key], {
        runId, createdAt, ...pick(item, ["key", "value"]),
      }, ["value", "created_at"]);
  }
}

export async function stageReadingDaySnapshots(
  db: AppDb,
  runId: number,
  rows: { year: number; day: string; readSeconds: number; source: string }[],
) {
  const createdAt = nowUnix();
  const values = rows.map((row) => ({ runId, createdAt, ...row }));
  for (const chunk of rowParamLimitedChunks(values)) {
    await upsertMany(db, syncSnapshotReadingDays, [syncSnapshotReadingDays.runId, syncSnapshotReadingDays.year, syncSnapshotReadingDays.day], chunk, [
      "read_seconds",
      "source",
      "created_at",
    ]);
  }
}

export async function stageHighlightSnapshots(db: AppDb, runId: number, rows: Record<string, unknown>[]) {
  const createdAt = nowUnix();
  const values = rows.map((item) => ({
    runId,
    createdAt,
    ...pick(item, ["wereadBookId", "wereadBookmarkId", "chapterUid", "chapterTitle", "range", "markText", "colorStyle", "createTime", "rawJson"]),
  }));
  for (const chunk of rowParamLimitedChunks(values)) {
    await upsertMany(db, syncSnapshotHighlights, [syncSnapshotHighlights.runId, syncSnapshotHighlights.wereadBookmarkId], chunk, [
      "weread_book_id",
      "chapter_uid",
      "chapter_title",
      "range",
      "mark_text",
      "color_style",
      "create_time",
      "raw_json",
      "created_at",
    ]);
  }
}

export async function stageReviewSnapshots(db: AppDb, runId: number, rows: Record<string, unknown>[]) {
  const createdAt = nowUnix();
  const values = rows.map((item) => ({
    runId,
    createdAt,
    ...pick(item, ["wereadBookId", "wereadReviewId", "chapterUid", "chapterName", "range", "abstract", "content", "star", "isFinish", "reviewType", "createTime", "rawJson"]),
  }));
  for (const chunk of rowParamLimitedChunks(values)) {
    await upsertMany(db, syncSnapshotReviews, [syncSnapshotReviews.runId, syncSnapshotReviews.wereadReviewId], chunk, [
      "weread_book_id",
      "chapter_uid",
      "chapter_name",
      "range",
      "abstract",
      "content",
      "star",
      "is_finish",
      "review_type",
      "create_time",
      "raw_json",
      "created_at",
    ]);
  }
}

export function discardSnapshots(_runId: number) {}

export function parseSnapshot<T>(row: unknown) {
  return row as T;
}

function pick(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, source[key] ?? null]));
}

async function upsert(db: AppDb, table: unknown, target: unknown[], values: Record<string, unknown>, columns: string[]) {
  await (db as any).insert(table).values(values).onConflictDoUpdate({
    target,
    set: Object.fromEntries(columns.map((column) => [toCamel(column), sql.raw(`excluded.${column}`)])),
  });
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
