import type { ReadDataDetailResponse, WereadClient } from "@repo/weread-api";

import type { AlbumSnapshotInput, BookSnapshotInput, ShelfItemSnapshotInput } from "../db/repos/catalog.repo.ts";
import type { NotebookBookSnapshotInput } from "../db/repos/notebook.repo.ts";
import type { ReadingDaySnapshotInput, ReadingPeriodBookSnapshotInput, ReadingTopBookSnapshotInput } from "../db/repos/reading.repo.ts";
import type { RepoCtx } from "../db/repos/ctx.ts";
import type { BookDetailAndProgress, NotebookContent } from "./fetchers.ts";
import {
  albumFromShelf,
  bookFromDetail,
  bookFromNotebook,
  bookFromShelf,
  bookProgressFromProgress,
  highlightsFromBookmarkPayload,
  notebookBookFromNotebook,
  readingDayFromDateKey,
  readingPeriodRows,
  readingYearFromPayload,
  readingYearRows,
  reviewsFromReviewItems,
  shelfAlbumItemFromShelf,
  shelfBookItemFromShelf,
} from "./mappers.ts";
import type { NotebookSyncItem } from "./types.ts";
import { ONE_DAY_SECONDS, formatShanghaiDate, nowUnix } from "./utils.ts";

export async function stageShelf(
  repos: RepoCtx,
  runId: number,
  shelf: Awaited<ReturnType<WereadClient["getShelf"]>>,
  stagedBookIds: Set<string>,
) {
  const bookRows: BookSnapshotInput[] = [];
  const albumRows: AlbumSnapshotInput[] = [];
  const shelfRows: ShelfItemSnapshotInput[] = [];

  for (const book of shelf.books ?? []) {
    if (book.bookId && !stagedBookIds.has(book.bookId)) {
      stagedBookIds.add(book.bookId);
      bookRows.push(bookFromShelf(book));
    }
    shelfRows.push(shelfBookItemFromShelf(book));
  }

  for (const album of shelf.albums ?? []) {
    albumRows.push(albumFromShelf(album));
    shelfRows.push(shelfAlbumItemFromShelf(album));
  }

  await repos.catalog.stageBooks(runId, bookRows);
  await repos.catalog.stageAlbums(runId, albumRows);
  await repos.catalog.stageShelfItems(runId, shelfRows);
}

export async function stageBookDetailsAndProgress(repos: RepoCtx, runId: number, items: BookDetailAndProgress[]) {
  await repos.catalog.stageBooks(runId, items.map((item) => bookFromDetail(item.wereadBookId, item.detail)));
  await repos.catalog.stageBookProgresses(runId, items.map((item) => bookProgressFromProgress(item.wereadBookId, item.progress)));
}

export async function stageNotebooks(repos: RepoCtx, runId: number, notebooks: NotebookSyncItem[], stagedBookIds: Set<string>) {
  const bookRows: BookSnapshotInput[] = [];
  const notebookRows: NotebookBookSnapshotInput[] = [];

  for (const notebook of notebooks) {
    if (!stagedBookIds.has(notebook.bookId)) {
      stagedBookIds.add(notebook.bookId);
      bookRows.push(bookFromNotebook(notebook));
    }
    notebookRows.push(notebookBookFromNotebook(notebook));
  }

  await repos.catalog.stageBooks(runId, bookRows);
  await repos.notebook.stageNotebookBooks(runId, notebookRows);
}

export async function stageNotebookContents(repos: RepoCtx, runId: number, contents: NotebookContent[]) {
  await repos.notebook.stageHighlights(
    runId,
    contents.flatMap((content) => highlightsFromBookmarkPayload(content.wereadBookId, content.bookmarkPayload)),
  );
  await repos.notebook.stageReviews(
    runId,
    contents.flatMap((content) => reviewsFromReviewItems(content.wereadBookId, content.reviewsPayload)),
  );
}

export async function stageReadingPeriod(
  repos: RepoCtx,
  runId: number,
  periodType: string,
  payload: ReadDataDetailResponse,
  stagedBookIds: Set<string>,
) {
  const rows = readingPeriodRows(periodType, payload, stagedBookIds);
  await repos.reading.stageReadingPeriod(runId, rows.periodRow);
  await repos.catalog.stageBooks(runId, rows.bookRows);
  await repos.catalog.stageAlbums(runId, rows.albumRows);
  await repos.reading.stageReadingPeriodBooks(runId, rows.periodBookRows);
}

export async function stageReadingPeriods(
  repos: RepoCtx,
  runId: number,
  periodType: string,
  payloads: ReadDataDetailResponse[],
  stagedBookIds: Set<string>,
) {
  const periodRows = [];
  const bookRows: BookSnapshotInput[] = [];
  const albumRows: AlbumSnapshotInput[] = [];
  const periodBookRows: ReadingPeriodBookSnapshotInput[] = [];

  for (const payload of payloads) {
    const rows = readingPeriodRows(periodType, payload, stagedBookIds);
    periodRows.push(rows.periodRow);
    bookRows.push(...rows.bookRows);
    albumRows.push(...rows.albumRows);
    periodBookRows.push(...rows.periodBookRows);
  }

  await repos.reading.stageReadingPeriods(runId, periodRows);
  await repos.catalog.stageBooks(runId, bookRows);
  await repos.catalog.stageAlbums(runId, albumRows);
  await repos.reading.stageReadingPeriodBooks(runId, periodBookRows);
}

export async function stageReadingYears(
  repos: RepoCtx,
  runId: number,
  annuals: Array<{ year: number; annual: ReadDataDetailResponse }>,
  stagedBookIds: Set<string>,
) {
  const yearRows = [];
  const bookRows: BookSnapshotInput[] = [];
  const albumRows: AlbumSnapshotInput[] = [];
  const topBookRows: ReadingTopBookSnapshotInput[] = [];

  for (const { year, annual } of annuals) {
    const rows = readingYearRows(year, annual.readLongest ?? [], stagedBookIds);
    yearRows.push(readingYearFromPayload(year, annual));
    bookRows.push(...rows.bookRows);
    albumRows.push(...rows.albumRows);
    topBookRows.push(...rows.topBookRows);
  }

  await repos.reading.stageReadingYears(runId, yearRows);
  await repos.catalog.stageBooks(runId, bookRows);
  await repos.catalog.stageAlbums(runId, albumRows);
  await repos.reading.stageReadingTopBooks(runId, topBookRows);
}

export async function stageReadingDays(repos: RepoCtx, runId: number, yearlyDays: ReadingDaySnapshotInput[][]) {
  await repos.reading.stageReadingDays(runId, yearlyDays.flat());
}

export async function stageCurrentWeekReadingDays(repos: RepoCtx, runId: number, weekly: ReadDataDetailResponse) {
  const baseTime = weekly.baseTime ?? nowUnix();
  const bucketMap = new Map<string, number>();
  for (const [timestamp, seconds] of Object.entries(weekly.readTimes ?? {})) {
    bucketMap.set(formatShanghaiDate(Number(timestamp)), Number(seconds));
  }

  const weekDays = Array.from({ length: 7 }, (_, index) => formatShanghaiDate(baseTime + index * ONE_DAY_SECONDS));
  await repos.reading.stageReadingDays(runId, weekDays.map((day) => readingDayFromDateKey(day, bucketMap.get(day) ?? 0, "weekly_current")));

  return weekDays.length;
}
