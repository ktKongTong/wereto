import type { ReadDataDetailResponse, ReadDataLongestItem, WereadClient } from "@repo/weread-api";

import type { AlbumSnapshotInput, BookSnapshotInput } from "../db/repos/catalog.repo.ts";
import type { HighlightSnapshotInput, ReviewSnapshotInput } from "../db/repos/notebook.repo.ts";
import type { ReadingDaySnapshotInput } from "../db/repos/reading.repo.ts";
import type { NotebookSyncItem, ReadDataAlbum, ReadDataBook, ReviewItem } from "./types.ts";
import { formatShanghaiDate, getPeriodEndKey, getPeriodStartKey } from "./utils.ts";

type Shelf = Awaited<ReturnType<WereadClient["getShelf"]>>;
type ShelfBook = NonNullable<Shelf["books"]>[number];
type ShelfAlbum = NonNullable<Shelf["albums"]>[number];
type NotebookPageBook = NonNullable<Awaited<ReturnType<WereadClient["getNotebooks"]>>["books"]>[number];
type BookmarkPayload = Awaited<ReturnType<WereadClient["getBookmarkList"]>>;
type BookmarkItem = NonNullable<BookmarkPayload["updated"]>[number] & { markText: string };
type ReviewWithContent = ReviewItem & { content: string };
type TitleSource = {
  title?: string | null;
  name?: string | null;
  author?: string | null;
  authorName?: string | null;
  cover?: string | null;
  category?: string | null;
};

export const bookFromShelf = (book: ShelfBook) => bookSnapshot(book.bookId, book, book);

export const albumFromShelf = (album: ShelfAlbum) => albumSnapshot(album.albumInfo.albumId, album.albumInfo, album);

export function shelfBookItemFromShelf(book: ShelfBook) {
  return {
    entityKey: `book:${book.bookId}`,
    itemType: "book",
    wereadBookId: book.bookId,
    ...titleFields(book, "未知书籍"),
    isTop: book.isTop ?? 0,
    isSecret: book.secret ?? 0,
    finishReading: book.finishReading ?? 0,
    readUpdateTime: book.readUpdateTime,
    sourceUpdateTime: book.updateTime,
    rawJson: book,
  };
}

export function shelfAlbumItemFromShelf(album: ShelfAlbum) {
  const { albumInfo: info, albumInfoExtra: extra } = album;
  return {
    entityKey: `album:${info.albumId}`,
    itemType: "album",
    wereadAlbumId: info.albumId,
    ...titleFields(info, "未知专辑"),
    category: null,
    isTop: extra?.isTop ?? 0,
    isSecret: extra?.secret ?? 0,
    finishReading: 0,
    readUpdateTime: extra?.lectureReadUpdateTime,
    sourceUpdateTime: info.updateTime,
    rawJson: album,
  };
}

export function notebookFromApiItem(item: NotebookPageBook): NotebookSyncItem {
  const reviewCount = item.reviewCount ?? 0;
  const noteCount = item.noteCount ?? 0;
  const bookmarkCount = item.bookmarkCount ?? 0;
  return {
    bookId: item.bookId,
    title: item.book?.title ?? "未知书籍",
    author: item.book?.author ?? "",
    cover: item.book?.cover ?? "",
    reviewCount,
    noteCount,
    bookmarkCount,
    totalCount: reviewCount + noteCount + bookmarkCount,
    readingProgress: item.readingProgress ?? null,
    markedStatus: item.markedStatus ?? null,
    sort: item.sort ?? 0,
    rawJson: item,
  };
}

export const bookFromNotebook = (notebook: NotebookSyncItem) => bookSnapshot(notebook.bookId, notebook, notebook.rawJson);

export function notebookBookFromNotebook(notebook: NotebookSyncItem) {
  const { bookId, title: _title, author: _author, cover: _cover, ...row } = notebook;
  return { ...row, wereadBookId: bookId };
}

export function bookFromDetail(wereadBookId: string, detail: Awaited<ReturnType<WereadClient["getBookInfo"]>>) {
  return {
    ...bookSnapshot(wereadBookId, detail, detail),
    ...pick(detail, ["intro", "publisher", "isbn", "wordCount"]),
    rating: detail.newRating,
    ratingCount: detail.newRatingCount,
  };
}

export function bookInfoFromDetail(wereadBookId: string, detail: Awaited<ReturnType<WereadClient["getBookInfo"]>>) {
  return {
    ...bookFromDetail(wereadBookId, detail),
    translator: detail.translator,
    publishTime: detail.publishTime,
    ratingDetailJson: detail.newRatingDetail ?? null,
  };
}

export function bookProgressFromProgress(wereadBookId: string, progress: Awaited<ReturnType<WereadClient["getProgress"]>>) {
  return {
    ...pick(progress.book ?? {}, ["chapterUid", "chapterOffset", "progress", "recordReadingTime", "finishTime", "isStartReading"]),
    wereadBookId,
    sourceUpdateTime: progress.book?.updateTime,
    sourceTimestamp: progress.timestamp,
    rawJson: progress,
  };
}

export function highlightsFromBookmarkPayload(wereadBookId: string, payload: BookmarkPayload): HighlightSnapshotInput[] {
  const chapterTitleMap = new Map((payload.chapters ?? []).map((chapter) => [chapter.chapterUid, chapter.title ?? null]));
  return (payload.updated ?? []).flatMap((item) => {
    if (!item.markText) return [];
    const bookmarkId = item.bookmarkId ?? `${wereadBookId}:${item.range ?? ""}:${item.createTime ?? 0}`;
    return [highlightFromBookmark(wereadBookId, bookmarkId, item as BookmarkItem, chapterTitleMap)];
  });
}

export function reviewsFromReviewItems(wereadBookId: string, reviews: ReviewItem[]): ReviewSnapshotInput[] {
  return reviews.flatMap((item) => {
    if (!item.content) return [];
    const reviewId = item.reviewId ?? `${wereadBookId}:${item.createTime ?? 0}:${item.content.slice(0, 16)}`;
    return [reviewFromReviewItem(wereadBookId, reviewId, item as ReviewWithContent)];
  });
}

export function readingYearFromPayload(year: number, payload: ReadDataDetailResponse) {
  return { year, ...readSummary(payload), rawJson: payload };
}

export function readingYearRows(year: number, items: ReadDataLongestItem[], stagedBookIds: Set<string>) {
  const rows = collectReadingRows(items, stagedBookIds, (item, rank) => ({ year, ...readingItemFields(rank, item) }));
  return { bookRows: rows.bookRows, albumRows: rows.albumRows, topBookRows: rows.itemRows };
}

export function readingPeriodRows(periodType: string, payload: ReadDataDetailResponse, stagedBookIds: Set<string>) {
  const baseTime = payload.baseTime ?? 0;
  const periodStart = getPeriodStartKey(periodType, baseTime);
  const periodEnd = getPeriodEndKey(periodType, baseTime) ?? periodStart;
  const periodKey = `${periodType}:${periodStart}`;
  const rows = collectReadingRows(payload.readLongest ?? [], stagedBookIds, (item, rank) => ({
    periodKey,
    ...readingItemFields(rank, item),
    rawJson: item,
  }));

  return {
    periodRow: {
      periodType,
      periodStart,
      periodEnd,
      baseTime,
      ...readSummary(payload),
      readTimesJson: payload.readTimes ?? null,
      readStatJson: payload.readStat ?? null,
      rawJson: payload,
    },
    bookRows: rows.bookRows,
    albumRows: rows.albumRows,
    periodBookRows: rows.itemRows,
  };
}

export const readingDayFromBucket = (year: number, timestamp: string, seconds: number, source: string): ReadingDaySnapshotInput => ({
  year,
  day: formatShanghaiDate(Number(timestamp)),
  readSeconds: Number(seconds),
  source,
});

export const readingDayFromDateKey = (day: string, seconds: number, source: string): ReadingDaySnapshotInput => ({
  year: Number(day.slice(0, 4)),
  day,
  readSeconds: seconds,
  source,
});

function highlightFromBookmark(
  wereadBookId: string,
  wereadBookmarkId: string,
  item: BookmarkItem,
  chapterTitleMap: Map<number, string | null>,
) {
  return {
    ...pick(item, ["chapterUid", "range", "markText", "colorStyle"]),
    wereadBookId,
    wereadBookmarkId,
    chapterTitle: item.chapterUid ? chapterTitleMap.get(item.chapterUid) ?? null : null,
    markText: item.markText,
    createTime: item.createTime ?? 0,
    rawJson: item,
  };
}

function reviewFromReviewItem(wereadBookId: string, wereadReviewId: string, item: ReviewWithContent) {
  return {
    ...pick(item, ["chapterUid", "chapterName", "range", "abstract", "content", "star", "isFinish"]),
    wereadBookId,
    wereadReviewId,
    content: item.content,
    reviewType: inferReviewType(item),
    createTime: item.createTime ?? 0,
    rawJson: item,
  };
}

function collectReadingRows<T>(items: ReadDataLongestItem[], stagedBookIds: Set<string>, mapItem: (item: ReadDataLongestItem, rank: number) => T) {
  const bookRows: BookSnapshotInput[] = [];
  const albumRows: AlbumSnapshotInput[] = [];
  const itemRows: T[] = [];

  for (const [index, item] of items.entries()) {
    if (item.book?.bookId && !stagedBookIds.has(item.book.bookId)) {
      stagedBookIds.add(item.book.bookId);
      bookRows.push(bookFromReadData(item.book));
    }
    if (item.albumInfo?.albumId) albumRows.push(albumFromReadData(item.albumInfo));
    itemRows.push(mapItem(item, index + 1));
  }

  return { bookRows, albumRows, itemRows };
}

function readingItemFields(rank: number, item: ReadDataLongestItem) {
  return {
    rank,
    wereadBookId: item.book?.bookId ?? null,
    wereadAlbumId: item.albumInfo?.albumId ?? null,
    readTime: item.readTime ?? 0,
    recordReadingTime: item.recordReadingTime ?? 0,
    tagsJson: item.tags ?? [],
    ...titleFields(item.book ?? item.albumInfo ?? {}, "未知条目"),
  };
}

function bookFromReadData(book: ReadDataBook): BookSnapshotInput {
  if (!book.bookId) throw new Error("Read data book is missing bookId");
  return bookSnapshot(book.bookId, book, book);
}

function albumFromReadData(album: ReadDataAlbum): AlbumSnapshotInput {
  if (!album.albumId) throw new Error("Read data album is missing albumId");
  return albumSnapshot(album.albumId, album, album);
}

function bookSnapshot(wereadBookId: string, source: TitleSource, rawJson: unknown): BookSnapshotInput {
  return { wereadBookId, ...titleFields(source, "未知书籍"), rawJson };
}

function albumSnapshot(wereadAlbumId: string, source: TitleSource & Partial<Pick<AlbumSnapshotInput, "trackCount" | "finishStatus" | "intro">>, rawJson: unknown): AlbumSnapshotInput {
  return {
    wereadAlbumId,
    name: source.name ?? "未知专辑",
    authorName: source.authorName,
    cover: source.cover,
    trackCount: source.trackCount,
    finishStatus: source.finishStatus,
    intro: source.intro,
    rawJson,
  };
}

function titleFields(source: TitleSource, fallback: string) {
  return {
    title: source.title ?? source.name ?? fallback,
    author: source.author ?? source.authorName,
    cover: source.cover,
    category: source.category,
  };
}

function readSummary(payload: ReadDataDetailResponse) {
  return {
    totalReadTime: payload.totalReadTime ?? 0,
    readDays: payload.readDays ?? 0,
    dayAverageReadTime: payload.dayAverageReadTime ?? 0,
    compare: payload.compare !== undefined ? Math.round(payload.compare * 10000) : null,
  };
}

function inferReviewType(review: ReviewItem) {
  if (review.chapterName && review.abstract) return "thought";
  if (review.chapterName) return "chapter_review";
  if (review.isFinish !== undefined || (review.star ?? -1) >= 0) return "book_review";
  return "unknown";
}

function pick<T extends object, K extends keyof T>(source: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, source[key]])) as Pick<T, K>;
}
