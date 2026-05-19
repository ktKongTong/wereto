import { and, desc, eq, inArray } from "drizzle-orm";
import type { ShelfAlbumItem, ShelfBookItem } from "../../../../../packages/weread-api/src/index.ts";

import { formatDateKey } from "../../lib/format.ts";
import type { AppDb } from "./client.ts";
import {
  albums,
  books,
  highlights,
  notebookBooks,
  readBooks,
  readingDays,
  readingTopBooks,
  readingYears,
  reviews,
  shelfItems,
  syncRunLogs,
  syncRuns,
} from "./schema.ts";

const ANNUAL_ANNOTATION_PREVIEW_LIMIT = 10;

export interface HistoryYearRecord {
  year: number;
  annual: {
    totalReadTime: number;
    readDays: number;
    dayAverageReadTime: number;
    compare?: number;
    readLongest: Array<{
      readTime: number;
      recordReadingTime: number;
      tags?: string[];
      book?: {
        title?: string;
        author?: string;
        cover?: string;
      };
      albumInfo?: {
        name?: string;
        authorName?: string;
        cover?: string;
      };
    }>;
    readStat: Array<{ stat: string; counts: string }>;
  };
  annotations: {
    notebookBooks: number;
    highlights: number;
    reviews: number;
    recentHighlights: Array<{
      bookTitle: string;
      cover: string;
      content: string;
      createTime: number;
    }>;
    recentReviews: Array<{
      bookTitle: string;
      cover: string;
      content: string;
      createTime: number;
    }>;
  };
  cells: Array<{
    key: string;
    label: string;
    month: number;
    weekIndex: number;
    weekDayIndex: number;
    inYear: boolean;
    seconds: number;
  }>;
  maxValue: number;
  contributionDays: number;
}

export interface ArchiveNotebookSummary {
  bookId: string;
  title: string;
  author: string;
  cover: string;
  reviewCount: number;
  noteCount: number;
  bookmarkCount: number;
  totalCount: number;
  sort: number;
}

export interface ArchiveNotebookDetail extends ArchiveNotebookSummary {
  highlights: Array<{
    markText: string;
    createTime: number;
  }>;
  reviews: Array<{
    content: string;
    chapterName?: string | null;
    createTime: number;
  }>;
}

export interface ArchiveTimelineItem {
  type: "review" | "highlight";
  bookTitle: string;
  cover: string;
  content: string;
  createTime: number;
}

export interface ArchiveReadBook {
  bookId: string;
  title: string;
  author: string;
  cover: string;
  totalReadTime: number;
  seenPeriods: number;
  firstSeenPeriodStart: string;
  lastSeenPeriodStart: string;
  inShelf: boolean;
}

export async function getHistoryFromDb(db: AppDb) {
  const yearRows = await db.select().from(readingYears).orderBy(readingYears.year);
  const years = yearRows.map((row) => row.year);
  const dayRows = await db.select().from(readingDays).orderBy(readingDays.day);
  const topRows = await db.select().from(readingTopBooks).orderBy(readingTopBooks.year, readingTopBooks.rank);
  const highlightRows = await db.select().from(highlights).orderBy(desc(highlights.createTime));
  const reviewRows = await db.select().from(reviews).orderBy(desc(reviews.createTime));
  const annotationBookIds = Array.from(new Set([...highlightRows.map((row) => row.bookId), ...reviewRows.map((row) => row.bookId)]));
  const annotationBooks = await selectInChunks(db, books, books.id, annotationBookIds);
  const annotationBookMap = new Map(annotationBooks.map((row) => [row.id, row]));
  const annotationsByYear = buildAnnualAnnotations(years, highlightRows, reviewRows, annotationBookMap);

  const records: HistoryYearRecord[] = yearRows.map((yearRow) => {
    const days = dayRows.filter((row) => row.year === yearRow.year);
    const cells = buildCalendarCells(yearRow.year, days);
    const tops = topRows.filter((row) => row.year === yearRow.year);

    return {
      year: yearRow.year,
      annual: {
        totalReadTime: yearRow.totalReadTime,
        readDays: yearRow.readDays,
        dayAverageReadTime: yearRow.dayAverageReadTime,
        compare: yearRow.compare !== null && yearRow.compare !== undefined ? yearRow.compare / 10_000 : undefined,
        readLongest: tops.map((row) => ({
          readTime: row.readTime,
          recordReadingTime: row.recordReadingTime,
          tags: row.tagsJson ? JSON.parse(row.tagsJson) : [],
          book: row.bookId
            ? {
                title: row.titleSnapshot,
                author: row.authorSnapshot ?? undefined,
                cover: row.coverSnapshot ?? undefined,
              }
            : undefined,
          albumInfo: row.albumId
            ? {
                name: row.titleSnapshot,
                authorName: row.authorSnapshot ?? undefined,
                cover: row.coverSnapshot ?? undefined,
              }
            : undefined,
        })),
        readStat: [],
      },
      annotations: annotationsByYear.get(yearRow.year) ?? createEmptyAnnualAnnotations(),
      cells,
      maxValue: Math.max(1, ...cells.map((cell) => cell.seconds)),
      contributionDays: cells.filter((cell) => cell.inYear && cell.seconds > 0).length,
    };
  });

  return {
    overall: {
      totalReadTime: yearRows.reduce((sum, row) => sum + row.totalReadTime, 0),
    },
    years,
    records,
  };
}

function createEmptyAnnualAnnotations(): HistoryYearRecord["annotations"] {
  return {
    notebookBooks: 0,
    highlights: 0,
    reviews: 0,
    recentHighlights: [],
    recentReviews: [],
  };
}

function buildAnnualAnnotations(
  years: number[],
  highlightRows: Array<typeof highlights.$inferSelect>,
  reviewRows: Array<typeof reviews.$inferSelect>,
  bookMap: Map<number, typeof books.$inferSelect>,
) {
  const yearSet = new Set(years);
  const annotations = new Map<number, HistoryYearRecord["annotations"]>();
  const bookIdsByYear = new Map<number, Set<number>>();

  for (const year of years) {
    annotations.set(year, createEmptyAnnualAnnotations());
    bookIdsByYear.set(year, new Set());
  }

  for (const row of highlightRows) {
    const year = getUnixYear(row.createTime);
    if (!yearSet.has(year)) continue;
    const annual = annotations.get(year)!;
    const book = bookMap.get(row.bookId);
    annual.highlights += 1;
    bookIdsByYear.get(year)!.add(row.bookId);
    if (annual.recentHighlights.length < ANNUAL_ANNOTATION_PREVIEW_LIMIT) {
      annual.recentHighlights.push({
        bookTitle: book?.title ?? "未知书籍",
        cover: book?.cover ?? "",
        content: row.markText,
        createTime: row.createTime,
      });
    }
  }

  for (const row of reviewRows) {
    const year = getUnixYear(row.createTime);
    if (!yearSet.has(year)) continue;
    const annual = annotations.get(year)!;
    const book = bookMap.get(row.bookId);
    annual.reviews += 1;
    bookIdsByYear.get(year)!.add(row.bookId);
    if (annual.recentReviews.length < ANNUAL_ANNOTATION_PREVIEW_LIMIT) {
      annual.recentReviews.push({
        bookTitle: book?.title ?? "未知书籍",
        cover: book?.cover ?? "",
        content: row.content,
        createTime: row.createTime,
      });
    }
  }

  for (const [year, bookIds] of bookIdsByYear) {
    annotations.get(year)!.notebookBooks = bookIds.size;
  }

  return annotations;
}

function getUnixYear(value: number) {
  if (!value) return Number.NaN;
  return new Date(value * 1000).getUTCFullYear();
}

export async function getArchiveFromDb(db: AppDb) {
  const shelfRows = await db.select().from(shelfItems).orderBy(desc(shelfItems.readUpdateTime), desc(shelfItems.updatedAt));
  const notebookRows = await db.select().from(notebookBooks).orderBy(desc(notebookBooks.totalCount), desc(notebookBooks.sort));
  const readBookRows = await db.select().from(readBooks).orderBy(desc(readBooks.totalReadTime), desc(readBooks.lastSeenPeriodStart));

  const bookIds = Array.from(
    new Set([
      ...shelfRows.map((row) => row.bookId).filter((v): v is number => v !== null),
      ...notebookRows.map((row) => row.bookId),
      ...readBookRows.map((row) => row.bookId),
    ]),
  );
  const bookRows = await selectInChunks(db, books, books.id, bookIds);
  const bookMap = new Map(bookRows.map((row) => [row.id, row]));
  const shelfBookIds = new Set(shelfRows.map((row) => row.bookId).filter((v): v is number => v !== null));

  const selectedNotebookRows = notebookRows.slice(0, 12);
  const selectedBookIds = selectedNotebookRows.map((row) => row.bookId);
  const selectedHighlightRows = selectedBookIds.length
    ? await selectInChunks(db, highlights, highlights.bookId, selectedBookIds, (query) => query.orderBy(desc(highlights.createTime)))
    : [];
  const selectedReviewRows = selectedBookIds.length
    ? await selectInChunks(db, reviews, reviews.bookId, selectedBookIds, (query) => query.orderBy(desc(reviews.createTime)))
    : [];
  const timelineHighlightRows = await db.select().from(highlights).orderBy(desc(highlights.createTime));
  const timelineReviewRows = await db.select().from(reviews).orderBy(desc(reviews.createTime));
  const timelineBookIds = Array.from(new Set([...timelineHighlightRows.map((row) => row.bookId), ...timelineReviewRows.map((row) => row.bookId)]));
  const timelineBookRows = await selectInChunks(db, books, books.id, timelineBookIds);
  const timelineBookMap = new Map([...bookMap, ...timelineBookRows.map((row) => [row.id, row] as const)]);

  const notebookDetails: ArchiveNotebookDetail[] = selectedNotebookRows.map((row) => {
    const book = bookMap.get(row.bookId);
    return {
      bookId: book?.wereadBookId ?? String(row.bookId),
      title: book?.title ?? "未知书籍",
      author: book?.author ?? "",
      cover: book?.cover ?? "",
      reviewCount: row.reviewCount,
      noteCount: row.noteCount,
      bookmarkCount: row.bookmarkCount,
      totalCount: row.totalCount,
      sort: row.sort,
      highlights: selectedHighlightRows
        .filter((item) => item.bookId === row.bookId)
        .slice(0, 2)
        .map((item) => ({
          markText: item.markText,
          createTime: item.createTime,
        })),
      reviews: selectedReviewRows
        .filter((item) => item.bookId === row.bookId)
        .slice(0, 2)
        .map((item) => ({
          content: item.content,
          chapterName: item.chapterName,
          createTime: item.createTime,
        })),
    };
  });

  const timeline = buildTimelineFromRows(timelineHighlightRows, timelineReviewRows, timelineBookMap);

  const readBookDetails: ArchiveReadBook[] = readBookRows.map((row) => {
    const book = bookMap.get(row.bookId);
    return {
      bookId: book?.wereadBookId ?? String(row.bookId),
      title: book?.title ?? "未知书籍",
      author: book?.author ?? "",
      cover: book?.cover ?? "",
      totalReadTime: row.totalReadTime,
      seenPeriods: row.seenPeriods,
      firstSeenPeriodStart: row.firstSeenPeriodStart,
      lastSeenPeriodStart: row.lastSeenPeriodStart,
      inShelf: shelfBookIds.has(row.bookId),
    };
  });

  const shelfBooks: ShelfBookItem[] = shelfRows
    .filter((row) => row.itemType === "book" && row.bookId !== null)
    .map((row) => ({
      bookId: bookMap.get(row.bookId!)?.wereadBookId ?? String(row.bookId),
      title: row.titleSnapshot,
      author: row.authorSnapshot ?? undefined,
      cover: row.coverSnapshot ?? undefined,
      category: row.categorySnapshot ?? undefined,
      readUpdateTime: row.readUpdateTime ?? undefined,
      finishReading: row.finishReading,
      updateTime: row.sourceUpdateTime ?? undefined,
      isTop: row.isTop,
      secret: row.isSecret,
    }));

  const albumRows = shelfRows.filter((row) => row.itemType === "album" && row.albumId !== null);
  const albumIds = albumRows.map((row) => row.albumId!).filter((value, index, array) => array.indexOf(value) === index);
  const albumEntities = await selectInChunks(db, albums, albums.id, albumIds);
  const albumMap = new Map(albumEntities.map((row) => [row.id, row]));
  const shelfAlbums: ShelfAlbumItem[] = albumRows.map((row) => {
    const album = albumMap.get(row.albumId!);
    return {
      albumInfo: {
        albumId: album?.wereadAlbumId ?? String(row.albumId),
        name: row.titleSnapshot,
        authorName: row.authorSnapshot ?? undefined,
        cover: row.coverSnapshot ?? undefined,
        trackCount: album?.trackCount ?? undefined,
        finishStatus: album?.finishStatus ?? undefined,
        intro: album?.intro ?? undefined,
        updateTime: album?.updatedAt ?? undefined,
      },
      albumInfoExtra: {
        secret: row.isSecret,
        isTop: row.isTop,
        lectureReadUpdateTime: row.readUpdateTime ?? undefined,
      },
    };
  });

  return {
    shelfBooks,
    shelfAlbums,
    mp: null,
    notebookBooks: notebookRows.map((row) => ({ bookId: String(row.bookId) })),
    notebookDetails,
    readBooks: readBookDetails,
    readBooksNotInShelf: readBookDetails.filter((book) => !book.inShelf),
    timeline,
  };
}

async function selectInChunks<TTable extends { [key: string]: any }, TColumn extends { name: string }>(
  db: AppDb,
  table: TTable,
  column: TColumn,
  values: number[],
  decorate?: (query: any) => any,
) {
  if (values.length === 0) return [];

  const chunkSize = 100;
  const rows: any[] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    const chunk = values.slice(index, index + chunkSize);
    let query = db.select().from(table as any).where(inArray(column as any, chunk));
    if (decorate) {
      query = decorate(query);
    }
    rows.push(...(await query));
  }

  return rows;
}

export async function getSyncRunById(db: AppDb, runId: number) {
  const [row] = await db.select().from(syncRuns).where(eq(syncRuns.id, runId)).limit(1);
  if (!row) return null;

  const logs = await db.select().from(syncRunLogs).where(eq(syncRunLogs.runId, runId)).orderBy(syncRunLogs.createdAt, syncRunLogs.id);
  return {
    ...row,
    logs,
  };
}

export async function listSyncRuns(db: AppDb, limit = 20) {
  return db.select().from(syncRuns).orderBy(desc(syncRuns.id)).limit(limit);
}

function buildCalendarCells(year: number, dayRows: Array<{ day: string; readSeconds: number }>) {
  const dayMap = new Map(dayRows.map((row) => [row.day, row.readSeconds]));
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  const mondayAlignedStart = new Date(start);
  const mondayOffset = (mondayAlignedStart.getUTCDay() + 6) % 7;
  mondayAlignedStart.setUTCDate(mondayAlignedStart.getUTCDate() - mondayOffset);
  const cells = [];
  const cursor = new Date(mondayAlignedStart);

  while (cursor <= end || ((cursor.getUTCDay() + 6) % 7) !== 0) {
    const current = new Date(cursor);
    const key = formatDateKey(current);
    const inYear = current.getUTCFullYear() === year;
    const diffDays = Math.floor((current.getTime() - mondayAlignedStart.getTime()) / 86_400_000);
    cells.push({
      key,
      label: key,
      month: current.getUTCMonth(),
      weekIndex: Math.floor(diffDays / 7),
      weekDayIndex: (current.getUTCDay() + 6) % 7,
      inYear,
      seconds: inYear ? dayMap.get(key) ?? 0 : 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor > end && ((cursor.getUTCDay() + 6) % 7) === 0) break;
  }

  return cells;
}

function buildTimeline(details: ArchiveNotebookDetail[]): ArchiveTimelineItem[] {
  return details
    .flatMap((detail) => [
      ...detail.reviews.map((review) => ({
        type: "review" as const,
        bookTitle: detail.title,
        cover: detail.cover,
        content: review.content,
        createTime: review.createTime,
      })),
      ...detail.highlights.map((highlight) => ({
        type: "highlight" as const,
        bookTitle: detail.title,
        cover: detail.cover,
        content: highlight.markText,
        createTime: highlight.createTime,
      })),
    ])
    .sort((a, b) => b.createTime - a.createTime);
}

function buildTimelineFromRows(
  highlightRows: Array<typeof highlights.$inferSelect>,
  reviewRows: Array<typeof reviews.$inferSelect>,
  bookMap: Map<number, typeof books.$inferSelect>,
): ArchiveTimelineItem[] {
  return [
    ...reviewRows.map((review) => {
      const book = bookMap.get(review.bookId);
      return {
        type: "review" as const,
        bookTitle: book?.title ?? "未知书籍",
        cover: book?.cover ?? "",
        content: review.content,
        createTime: review.createTime,
      };
    }),
    ...highlightRows.map((highlight) => {
      const book = bookMap.get(highlight.bookId);
      return {
        type: "highlight" as const,
        bookTitle: book?.title ?? "未知书籍",
        cover: book?.cover ?? "",
        content: highlight.markText,
        createTime: highlight.createTime,
      };
    }),
  ].sort((a, b) => b.createTime - a.createTime);
}

export type { ShelfBookItem, ShelfAlbumItem };
