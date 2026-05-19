import { sql } from "drizzle-orm";

import {
  albums,
  bookInfo,
  bookProgress,
  books,
  notebookBooks,
  shelfItems,
} from "../db/schema.ts";
import { parseSnapshot } from "./snapshots.ts";
import type { AlbumSnapshot, BookSnapshot, DbLike, SnapshotRow } from "./types.ts";
import { rowParamLimitedChunks } from "./utils.ts";

export async function commitBooks(db: DbLike, rows: SnapshotRow[], now: number) {
  const values = rows.map((row) => {
    const item = parseSnapshot<BookSnapshot>(row);
    return {
      wereadBookId: item.wereadBookId,
      title: item.title,
      author: item.author ?? null,
      cover: item.cover ?? null,
      intro: item.intro ?? null,
      category: item.category ?? null,
      publisher: item.publisher ?? null,
      isbn: item.isbn ?? null,
      wordCount: item.wordCount ?? null,
      rating: item.rating ?? null,
      ratingCount: item.ratingCount ?? null,
      rawJson: item.rawJson ?? null,
      updatedAt: now,
    };
  });
  for (const chunk of rowParamLimitedChunks(values)) {
    await db.insert(books).values(chunk).onConflictDoUpdate({
      target: books.wereadBookId,
      set: excluded(["title", "author", "cover", "intro", "category", "publisher", "isbn", "word_count", "rating", "rating_count", "raw_json", "updated_at"]),
    });
  }
  return loadBookIdMap(db);
}

export async function commitAlbums(db: DbLike, rows: SnapshotRow[], now: number) {
  const values = rows.map((row) => {
    const item = parseSnapshot<AlbumSnapshot>(row);
    return {
      wereadAlbumId: item.wereadAlbumId,
      name: item.name,
      authorName: item.authorName ?? null,
      cover: item.cover ?? null,
      trackCount: item.trackCount ?? null,
      finishStatus: item.finishStatus ?? null,
      intro: item.intro ?? null,
      rawJson: item.rawJson ?? null,
      updatedAt: now,
    };
  });
  for (const chunk of rowParamLimitedChunks(values)) {
    await db.insert(albums).values(chunk).onConflictDoUpdate({
      target: albums.wereadAlbumId,
      set: excluded(["name", "author_name", "cover", "track_count", "finish_status", "intro", "raw_json", "updated_at"]),
    });
  }
  return loadAlbumIdMap(db);
}

export async function loadBookIdMap(db: DbLike) {
  const rows = await db.select({ id: books.id, wereadBookId: books.wereadBookId }).from(books);
  return new Map(rows.map((row) => [row.wereadBookId, row.id]));
}

export async function loadAlbumIdMap(db: DbLike) {
  const rows = await db.select({ id: albums.id, wereadAlbumId: albums.wereadAlbumId }).from(albums);
  return new Map(rows.map((row) => [row.wereadAlbumId, row.id]));
}

export async function commitShelfItems(db: DbLike, rows: SnapshotRow[], bookIdMap: Map<string, number>, albumIdMap: Map<string, number>, now: number) {
  if (rows.length === 0) return;
  await db.delete(shelfItems);
  const values = rows.map((row) => {
    const item = parseSnapshot<Record<string, unknown>>(row);
    return {
      itemType: String(item.itemType),
      bookId: typeof item.wereadBookId === "string" ? bookIdMap.get(item.wereadBookId) ?? null : null,
      albumId: typeof item.wereadAlbumId === "string" ? albumIdMap.get(item.wereadAlbumId) ?? null : null,
      titleSnapshot: String(item.titleSnapshot ?? "未知条目"),
      authorSnapshot: typeof item.authorSnapshot === "string" ? item.authorSnapshot : null,
      coverSnapshot: typeof item.coverSnapshot === "string" ? item.coverSnapshot : null,
      categorySnapshot: typeof item.categorySnapshot === "string" ? item.categorySnapshot : null,
      isTop: Number(item.isTop ?? 0),
      isSecret: Number(item.isSecret ?? 0),
      finishReading: Number(item.finishReading ?? 0),
      readUpdateTime: typeof item.readUpdateTime === "number" ? item.readUpdateTime : null,
      sourceUpdateTime: typeof item.sourceUpdateTime === "number" ? item.sourceUpdateTime : null,
      rawJson: typeof item.rawJson === "string" ? item.rawJson : null,
      updatedAt: now,
    };
  });
  for (const chunk of rowParamLimitedChunks(values)) await db.insert(shelfItems).values(chunk);
}

export async function commitNotebookBooks(db: DbLike, rows: SnapshotRow[], bookIdMap: Map<string, number>, now: number) {
  const values = rows.flatMap((row) => {
    const item = parseSnapshot<Record<string, unknown>>(row);
    const bookId = typeof item.wereadBookId === "string" ? bookIdMap.get(item.wereadBookId) : undefined;
    if (!bookId) return [];
    return [{
      bookId,
      reviewCount: Number(item.reviewCount ?? 0),
      noteCount: Number(item.noteCount ?? 0),
      bookmarkCount: Number(item.bookmarkCount ?? 0),
      totalCount: Number(item.totalCount ?? 0),
      readingProgress: typeof item.readingProgress === "number" ? item.readingProgress : null,
      markedStatus: typeof item.markedStatus === "number" ? item.markedStatus : null,
      sort: Number(item.sort ?? 0),
      rawJson: typeof item.rawJson === "string" ? item.rawJson : null,
      updatedAt: now,
    }];
  });
  for (const chunk of rowParamLimitedChunks(values)) {
    await db.insert(notebookBooks).values(chunk).onConflictDoUpdate({
      target: notebookBooks.bookId,
      set: excluded(["review_count", "note_count", "bookmark_count", "total_count", "reading_progress", "marked_status", "sort", "raw_json", "updated_at"]),
    });
  }
}

export async function commitBookInfo(db: DbLike, rows: SnapshotRow[], bookIdMap: Map<string, number>, now: number) {
  const values = rows.flatMap((row) => mapBookLinkedRow(row, bookIdMap, now));
  for (const chunk of rowParamLimitedChunks(values)) {
    await db.insert(bookInfo).values(chunk).onConflictDoUpdate({
      target: bookInfo.bookId,
      set: excluded(["title", "author", "translator", "cover", "intro", "category", "publisher", "publish_time", "isbn", "word_count", "rating", "rating_count", "rating_detail_json", "raw_json", "updated_at"]),
    });
  }
}

export async function commitBookProgress(db: DbLike, rows: SnapshotRow[], bookIdMap: Map<string, number>, now: number) {
  const values = rows.flatMap((row) => {
    const item = parseSnapshot<Record<string, unknown>>(row);
    const bookId = typeof item.wereadBookId === "string" ? bookIdMap.get(item.wereadBookId) : undefined;
    if (!bookId) return [];
    return [{
      bookId,
      chapterUid: typeof item.chapterUid === "number" ? item.chapterUid : null,
      chapterOffset: typeof item.chapterOffset === "number" ? item.chapterOffset : null,
      progress: typeof item.progress === "number" ? item.progress : null,
      recordReadingTime: typeof item.recordReadingTime === "number" ? item.recordReadingTime : null,
      finishTime: typeof item.finishTime === "number" ? item.finishTime : null,
      isStartReading: typeof item.isStartReading === "number" ? item.isStartReading : null,
      sourceUpdateTime: typeof item.sourceUpdateTime === "number" ? item.sourceUpdateTime : null,
      sourceTimestamp: typeof item.sourceTimestamp === "number" ? item.sourceTimestamp : null,
      rawJson: typeof item.rawJson === "string" ? item.rawJson : null,
      updatedAt: now,
    }];
  });
  for (const chunk of rowParamLimitedChunks(values)) {
    await db.insert(bookProgress).values(chunk).onConflictDoUpdate({
      target: bookProgress.bookId,
      set: excluded(["chapter_uid", "chapter_offset", "progress", "record_reading_time", "finish_time", "is_start_reading", "source_update_time", "source_timestamp", "raw_json", "updated_at"]),
    });
  }
}

function mapBookLinkedRow(row: SnapshotRow, bookIdMap: Map<string, number>, now: number) {
  const item = parseSnapshot<Record<string, unknown>>(row);
  const bookId = typeof item.wereadBookId === "string" ? bookIdMap.get(item.wereadBookId) : undefined;
  if (!bookId) return [];
  return [{
    bookId,
    title: String(item.title ?? "未知书籍"),
    author: typeof item.author === "string" ? item.author : null,
    translator: typeof item.translator === "string" ? item.translator : null,
    cover: typeof item.cover === "string" ? item.cover : null,
    intro: typeof item.intro === "string" ? item.intro : null,
    category: typeof item.category === "string" ? item.category : null,
    publisher: typeof item.publisher === "string" ? item.publisher : null,
    publishTime: typeof item.publishTime === "string" ? item.publishTime : null,
    isbn: typeof item.isbn === "string" ? item.isbn : null,
    wordCount: typeof item.wordCount === "number" ? item.wordCount : null,
    rating: typeof item.rating === "number" ? item.rating : null,
    ratingCount: typeof item.ratingCount === "number" ? item.ratingCount : null,
    ratingDetailJson: typeof item.ratingDetailJson === "string" ? item.ratingDetailJson : null,
    rawJson: typeof item.rawJson === "string" ? item.rawJson : null,
    updatedAt: now,
  }];
}

function excluded(columns: string[]) {
  return Object.fromEntries(columns.map((column) => [toCamel(column), sql.raw(`excluded.${column}`)]));
}

function toCamel(column: string) {
  return column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
