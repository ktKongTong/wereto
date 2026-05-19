import type { ReadDataLongestItem, WereadClient } from "@repo/weread-api";

import type { AppDb } from "../db/client.ts";

export type DbLike = AppDb | Parameters<Parameters<AppDb["transaction"]>[0]>[0];
export type ReviewItem = NonNullable<NonNullable<Awaited<ReturnType<WereadClient["getMyReviews"]>>["reviews"]>[number]["review"]>;

export type SnapshotTarget =
  | "books"
  | "albums"
  | "shelf_items"
  | "notebook_books"
  | "book_info"
  | "book_progress"
  | "highlights"
  | "reviews"
  | "reading_periods"
  | "reading_period_books"
  | "reading_years"
  | "reading_top_books"
  | "reading_days"
  | "sync_cursors";

export type SnapshotRow = Record<string, unknown>;

export type BookSnapshot = {
  wereadBookId: string;
  title: string;
  author?: string | null;
  cover?: string | null;
  intro?: string | null;
  category?: string | null;
  publisher?: string | null;
  isbn?: string | null;
  wordCount?: number | null;
  rating?: number | null;
  ratingCount?: number | null;
  rawJson?: string | null;
};

export type AlbumSnapshot = {
  wereadAlbumId: string;
  name: string;
  authorName?: string | null;
  cover?: string | null;
  trackCount?: number | null;
  finishStatus?: string | null;
  intro?: string | null;
  rawJson?: string | null;
};

export type NotebookSyncItem = {
  bookId: string;
  title: string;
  author: string;
  cover: string;
  reviewCount: number;
  noteCount: number;
  bookmarkCount: number;
  totalCount: number;
  readingProgress: number | null;
  markedStatus: number | null;
  sort: number;
  rawJson: string;
};

export type ReadDataBook = NonNullable<ReadDataLongestItem["book"]>;
export type ReadDataAlbum = NonNullable<ReadDataLongestItem["albumInfo"]>;
