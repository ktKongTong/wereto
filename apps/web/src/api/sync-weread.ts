import { and, eq, inArray, sql } from "drizzle-orm";

import {
  createWereadClient,
  type ReadDataDetailResponse,
  type ReadDataLongestItem,
  type WereadClient,
} from "@repo/weread-api";

import { getDb, type AppDb, type DbEnv } from "./db/client.ts";
import { getConfigValue } from "./db/config.ts";
import {
  albums,
  bookInfo,
  bookProgress,
  books,
  highlights,
  notebookBooks,
  readBooks,
  readingDays,
  readingPeriodBooks,
  readingPeriods,
  readingTopBooks,
  readingYears,
  reviews,
  shelfItems,
  syncCursors,
  syncRuns,
  syncSnapshots,
} from "./db/schema.ts";
import { SyncRunLogger } from "./sync-logger.ts";

type DbLike = AppDb | Parameters<Parameters<AppDb["transaction"]>[0]>[0];
type ReviewItem = NonNullable<NonNullable<Awaited<ReturnType<WereadClient["getMyReviews"]>>["reviews"]>[number]["review"]>;

type SnapshotTarget =
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

type SnapshotRow = typeof syncSnapshots.$inferSelect;
type SnapshotInsert = typeof syncSnapshots.$inferInsert;

type BookSnapshot = {
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

type AlbumSnapshot = {
  wereadAlbumId: string;
  name: string;
  authorName?: string | null;
  cover?: string | null;
  trackCount?: number | null;
  finishStatus?: string | null;
  intro?: string | null;
  rawJson?: string | null;
};

type NotebookSyncItem = {
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

const ONE_DAY_SECONDS = 86400;
const FULL_SYNC_COMPLETED_CURSOR = "weread.sync.fullCompletedAt";

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function toJson(value: unknown) {
  return JSON.stringify(value);
}

function parseSnapshot<T>(row: SnapshotRow) {
  return JSON.parse(row.payloadJson) as T;
}

class SnapshotWriter {
  private readonly pending = new Map<string, SnapshotInsert>();

  constructor(private readonly runId: number) {}

  stage(targetTable: SnapshotTarget, entityKey: string, payload: unknown) {
    const key = `${targetTable}:${entityKey}`;
    this.pending.set(key, {
      runId: this.runId,
      targetTable,
      entityKey,
      operation: "upsert",
      payloadJson: toJson(payload),
      createdAt: nowUnix(),
    });
  }

  async flush(db: AppDb) {
    const rows = [...this.pending.values()];
    if (rows.length === 0) return;

    for (const chunk of chunkArray(rows, 10)) {
      await db
        .insert(syncSnapshots)
        .values(chunk)
        .onConflictDoUpdate({
          target: [syncSnapshots.runId, syncSnapshots.targetTable, syncSnapshots.entityKey],
          set: {
            operation: "upsert",
            payloadJson: sql.raw("excluded.payload_json"),
            createdAt: sql.raw("excluded.created_at"),
          },
        });
    }

    this.pending.clear();
  }
}

const snapshotWriters = new Map<number, SnapshotWriter>();

function getSnapshotWriter(runId: number) {
  let writer = snapshotWriters.get(runId);
  if (!writer) {
    writer = new SnapshotWriter(runId);
    snapshotWriters.set(runId, writer);
  }
  return writer;
}

async function flushSnapshots(db: AppDb, runId: number) {
  const writer = snapshotWriters.get(runId);
  if (!writer) return;

  await writer.flush(db);
  snapshotWriters.delete(runId);
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function syncWereadToDb(env: DbEnv, runId?: number) {
  const db = getDb(env);
  const apiKey = await getConfigValue(db, "weread.apiKey");

  if (!apiKey) {
    throw new Error("Missing weread.apiKey in app_config");
  }

  const client = createWereadClient({ apiKey });
  const startedAt = nowUnix();
  const activeRunId = runId ?? await createRun(db, startedAt);
  const logger = new SyncRunLogger(db, activeRunId);

  try {
    await updateRun(db, activeRunId, {
      status: "running",
      phase: "bootstrap",
      startedAt,
      updatedAt: nowUnix(),
    });
    await logger.info("bootstrap", "同步任务开始");
    await db.delete(syncSnapshots).where(eq(syncSnapshots.runId, activeRunId));

    const stagedBookIds = new Set<string>();
    const isIncremental = Boolean(await getCursor(db, FULL_SYNC_COMPLETED_CURSOR));

    await updateRun(db, activeRunId, {
      statsJson: toJson({ mode: isIncremental ? "incremental" : "full" }),
      updatedAt: nowUnix(),
    });

    if (isIncremental) {
      await runIncrementalSync(db, client, activeRunId, stagedBookIds, logger);
      return activeRunId;
    }

    const shelf = await client.getShelf();
    await updateRun(db, activeRunId, { phase: "shelf", updatedAt: nowUnix() });
    await logger.info("shelf", "开始同步书架");
    await stageShelf(db, activeRunId, shelf, stagedBookIds);
    await logger.info("shelf", "书架 snapshot 写入完成", {
      meta: { books: shelf.books?.length ?? 0, albums: shelf.albums?.length ?? 0 },
    });

    const notebookCheckpoint = await getCursor(db, "weread.notebooks.lastSort");
    const notebooks = await getChangedNotebooks(client, notebookCheckpoint ? Number(notebookCheckpoint) : null);
    await updateRun(db, activeRunId, {
      phase: "notebooks",
      progressTotal: notebooks.length,
      progressCurrent: 0,
      updatedAt: nowUnix(),
    });
    await logger.info("notebooks", "开始同步笔记本列表", {
      progressCurrent: 0,
      progressTotal: notebooks.length,
      meta: { changed: notebooks.length, checkpoint: notebookCheckpoint },
    });
    await stageNotebooks(db, activeRunId, notebooks, stagedBookIds);
    if (notebooks[0]?.sort) {
      await stageSnapshot(db, activeRunId, "sync_cursors", "weread.notebooks.lastSort", {
        key: "weread.notebooks.lastSort",
        value: String(notebooks[0].sort),
      });
    }
    await logger.info("notebooks", "笔记本列表 snapshot 写入完成", {
      progressCurrent: notebooks.length,
      progressTotal: notebooks.length,
    });

    const overall = await client.getReadData({ mode: "overall" });
    const currentYear = new Date().getFullYear();
    const startYear = overall.registTime ? new Date(overall.registTime * 1000).getFullYear() : currentYear;
    const periodTotal = estimateReadingPeriodCount(overall.registTime, nowUnix());

    await updateRun(db, activeRunId, {
      phase: "reading_periods",
      progressCurrent: 0,
      progressTotal: periodTotal,
      updatedAt: nowUnix(),
    });
    await logger.info("reading_periods", "开始同步历史阅读周期", {
      progressTotal: periodTotal,
      meta: { registTime: overall.registTime ?? null },
    });
    await stageReadingPeriods(db, client, overall, activeRunId, stagedBookIds, logger);
    await logger.info("reading_periods", "历史阅读周期 snapshot 写入完成");

    const yearCheckpoint = await getCursor(db, "weread.reading.lastFullYear");
    await updateRun(db, activeRunId, {
      phase: "reading_years",
      progressCurrent: 0,
      progressTotal: currentYear - startYear + 1,
      updatedAt: nowUnix(),
    });
    await logger.info("reading_years", "开始同步年度阅读统计", {
      progressCurrent: 0,
      progressTotal: currentYear - startYear + 1,
      meta: { startYear, currentYear },
    });
    for (let year = startYear; year <= currentYear; year += 1) {
      if (yearCheckpoint && year < currentYear && year <= Number(yearCheckpoint)) {
        await updateRun(db, activeRunId, {
          progressCurrent: year - startYear + 1,
          updatedAt: nowUnix(),
        });
        continue;
      }

      const annual = await client.getReadData({
        mode: "annually",
        baseTime: Math.floor(Date.UTC(year, 0, 1) / 1000),
      });
      await stageReadingYear(db, activeRunId, year, annual, stagedBookIds);
      await updateRun(db, activeRunId, {
        progressCurrent: year - startYear + 1,
        updatedAt: nowUnix(),
      });
      await logger.info("reading_years", `年度统计 snapshot 已写入 ${year}`, {
        progressCurrent: year - startYear + 1,
        progressTotal: currentYear - startYear + 1,
      });
    }

    await updateRun(db, activeRunId, {
      phase: "reading_days",
      progressCurrent: 0,
      progressTotal: currentYear - startYear + 1,
      updatedAt: nowUnix(),
    });
    await logger.info("reading_days", "开始同步每日阅读热力数据", {
      progressCurrent: 0,
      progressTotal: currentYear - startYear + 1,
    });
    for (let year = startYear; year <= currentYear; year += 1) {
      if (yearCheckpoint && year < currentYear && year <= Number(yearCheckpoint)) {
        await updateRun(db, activeRunId, {
          progressCurrent: year - startYear + 1,
          updatedAt: nowUnix(),
        });
        continue;
      }

      await stageReadingDaysForYear(db, client, activeRunId, year);
      await updateRun(db, activeRunId, {
        progressCurrent: year - startYear + 1,
        updatedAt: nowUnix(),
      });
      await logger.info("reading_days", `每日阅读 snapshot 已写入 ${year}`, {
        progressCurrent: year - startYear + 1,
        progressTotal: currentYear - startYear + 1,
      });
    }
    await stageSnapshot(db, activeRunId, "sync_cursors", "weread.reading.lastFullYear", {
      key: "weread.reading.lastFullYear",
      value: String(currentYear - 1),
    });

    await updateRun(db, activeRunId, {
      phase: "book_details",
      progressTotal: stagedBookIds.size,
      progressCurrent: 0,
      updatedAt: nowUnix(),
    });
    await logger.info("book_details", "开始补全书籍详情和阅读进度", {
      progressCurrent: 0,
      progressTotal: stagedBookIds.size,
    });
    let detailIndex = 0;
    for (const wereadBookId of stagedBookIds) {
      await stageBookDetailAndProgress(db, client, activeRunId, wereadBookId);
      detailIndex += 1;
      await updateRun(db, activeRunId, {
        progressCurrent: detailIndex,
        updatedAt: nowUnix(),
      });
      if (detailIndex % 25 === 0 || detailIndex === stagedBookIds.size) {
        await logger.info("book_details", `书籍详情 snapshot 已写入 ${detailIndex}/${stagedBookIds.size}`, {
          progressCurrent: detailIndex,
          progressTotal: stagedBookIds.size,
        });
      }
    }

    await updateRun(db, activeRunId, {
      phase: "highlights_reviews",
      progressCurrent: 0,
      progressTotal: notebooks.length,
      updatedAt: nowUnix(),
    });
    await logger.info("highlights_reviews", "开始同步划线和想法", {
      progressCurrent: 0,
      progressTotal: notebooks.length,
    });
    for (const [index, notebook] of notebooks.entries()) {
      await stageNotebookContent(db, client, activeRunId, notebook.bookId);
      await updateRun(db, activeRunId, {
        progressCurrent: index + 1,
        updatedAt: nowUnix(),
      });
      if ((index + 1) % 10 === 0 || index + 1 === notebooks.length) {
        await logger.info("highlights_reviews", `笔记内容 snapshot 已写入 ${index + 1}/${notebooks.length}`, {
          progressCurrent: index + 1,
          progressTotal: notebooks.length,
        });
      }
    }

    await updateRun(db, activeRunId, {
      phase: "commit",
      progressCurrent: 0,
      progressTotal: 1,
      updatedAt: nowUnix(),
    });
    await logger.info("commit", "开始批量提交 snapshot");
    await stageSnapshot(db, activeRunId, "sync_cursors", FULL_SYNC_COMPLETED_CURSOR, {
      key: FULL_SYNC_COMPLETED_CURSOR,
      value: String(nowUnix()),
    });
    await flushSnapshots(db, activeRunId);
    await commitStagedRun(db, activeRunId);

    await updateRun(db, activeRunId, {
      status: "success",
      phase: "finalize",
      finishedAt: nowUnix(),
      updatedAt: nowUnix(),
      resultJson: JSON.stringify({
        shelfBooks: shelf.books?.length ?? 0,
        shelfAlbums: shelf.albums?.length ?? 0,
        notebookBooks: notebooks.length,
        stagedBooks: stagedBookIds.size,
        startYear,
        currentYear,
      }),
    });
    await logger.info("finalize", "同步任务完成", {
      meta: {
        shelfBooks: shelf.books?.length ?? 0,
        shelfAlbums: shelf.albums?.length ?? 0,
        notebookBooks: notebooks.length,
        stagedBooks: stagedBookIds.size,
        startYear,
        currentYear,
      },
    });

    return activeRunId;
  } catch (error) {
    snapshotWriters.delete(activeRunId);
    await logger.error("failed", error instanceof Error ? error.message : String(error));
    await updateRun(db, activeRunId, {
      status: "failed",
      finishedAt: nowUnix(),
      updatedAt: nowUnix(),
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function runIncrementalSync(
  db: AppDb,
  client: WereadClient,
  runId: number,
  stagedBookIds: Set<string>,
  logger: SyncRunLogger,
) {
  await logger.info("bootstrap", "执行增量同步");

  await updateRun(db, runId, {
    phase: "reading_week",
    progressCurrent: 0,
    progressTotal: 1,
    updatedAt: nowUnix(),
  });
  await logger.info("reading_week", "开始同步当前周阅读统计", {
    progressCurrent: 0,
    progressTotal: 1,
  });

  const weekly = await client.getReadData({ mode: "weekly" });
  await stageReadingPeriod(db, runId, "weekly", weekly, stagedBookIds);
  const stagedDays = await stageCurrentWeekReadingDays(db, runId, weekly);

  await updateRun(db, runId, {
    progressCurrent: 1,
    updatedAt: nowUnix(),
  });
  await logger.info("reading_week", "当前周阅读 snapshot 写入完成", {
    progressCurrent: 1,
    progressTotal: 1,
    meta: {
      weekStart: weekly.baseTime ? formatShanghaiDate(weekly.baseTime) : null,
      stagedDays,
      topBooks: weekly.readLongest?.length ?? 0,
    },
  });

  await updateRun(db, runId, {
    phase: "book_details",
    progressCurrent: 0,
    progressTotal: stagedBookIds.size,
    updatedAt: nowUnix(),
  });
  await logger.info("book_details", "开始补全当前周书籍详情和阅读进度", {
    progressCurrent: 0,
    progressTotal: stagedBookIds.size,
  });
  let detailIndex = 0;
  for (const wereadBookId of stagedBookIds) {
    await stageBookDetailAndProgress(db, client, runId, wereadBookId);
    detailIndex += 1;
    await updateRun(db, runId, {
      progressCurrent: detailIndex,
      updatedAt: nowUnix(),
    });
  }

  await updateRun(db, runId, {
    phase: "commit",
    progressCurrent: 0,
    progressTotal: 1,
    updatedAt: nowUnix(),
  });
  await logger.info("commit", "开始提交当前周增量 snapshot");
  await flushSnapshots(db, runId);
  await commitStagedRun(db, runId);

  await updateRun(db, runId, {
    status: "success",
    phase: "finalize",
    finishedAt: nowUnix(),
    updatedAt: nowUnix(),
    resultJson: JSON.stringify({
      mode: "incremental",
      stagedBooks: stagedBookIds.size,
      stagedDays,
      weekStart: weekly.baseTime ? formatShanghaiDate(weekly.baseTime) : null,
    }),
  });
  await logger.info("finalize", "增量同步任务完成", {
    meta: {
      stagedBooks: stagedBookIds.size,
      stagedDays,
      weekStart: weekly.baseTime ? formatShanghaiDate(weekly.baseTime) : null,
    },
  });
}

async function createRun(db: AppDb, startedAt: number) {
  const [row] = await db
    .insert(syncRuns)
    .values({
      taskType: "weread_sync",
      source: "weread",
      status: "queued",
      phase: "queued",
      requestedAt: startedAt,
      startedAt,
      updatedAt: startedAt,
      progressCurrent: 0,
      progressTotal: 0,
      statsJson: "{}",
    })
    .returning();

  if (!row) {
    throw new Error("Failed to create sync run");
  }

  return row.id;
}

async function updateRun(db: AppDb, runId: number, patch: Partial<typeof syncRuns.$inferInsert>) {
  await db.update(syncRuns).set(patch).where(eq(syncRuns.id, runId));
}

async function stageSnapshot(_db: AppDb, runId: number, targetTable: SnapshotTarget, entityKey: string, payload: unknown) {
  getSnapshotWriter(runId).stage(targetTable, entityKey, payload);
}

async function stageBook(db: AppDb, runId: number, book: BookSnapshot, stagedBookIds: Set<string>) {
  if (!book.wereadBookId) return;
  stagedBookIds.add(book.wereadBookId);
  await stageSnapshot(db, runId, "books", book.wereadBookId, book);
}

async function stageAlbum(db: AppDb, runId: number, album: AlbumSnapshot) {
  if (!album.wereadAlbumId) return;
  await stageSnapshot(db, runId, "albums", album.wereadAlbumId, album);
}

async function stageShelf(
  db: AppDb,
  runId: number,
  shelf: Awaited<ReturnType<WereadClient["getShelf"]>>,
  stagedBookIds: Set<string>,
) {
  for (const item of shelf.books ?? []) {
    await stageBook(db, runId, {
      wereadBookId: item.bookId,
      title: item.title ?? "未知书籍",
      author: item.author,
      cover: item.cover,
      category: item.category,
      rawJson: toJson(item),
    }, stagedBookIds);

    await stageSnapshot(db, runId, "shelf_items", `book:${item.bookId}`, {
      itemType: "book",
      wereadBookId: item.bookId,
      titleSnapshot: item.title ?? "未知书籍",
      authorSnapshot: item.author,
      coverSnapshot: item.cover,
      categorySnapshot: item.category,
      isTop: item.isTop ?? 0,
      isSecret: item.secret ?? 0,
      finishReading: item.finishReading ?? 0,
      readUpdateTime: item.readUpdateTime,
      sourceUpdateTime: item.updateTime,
      rawJson: toJson(item),
    });
  }

  for (const album of shelf.albums ?? []) {
    await stageAlbum(db, runId, {
      wereadAlbumId: album.albumInfo.albumId,
      name: album.albumInfo.name ?? "未知专辑",
      authorName: album.albumInfo.authorName,
      cover: album.albumInfo.cover,
      trackCount: album.albumInfo.trackCount,
      finishStatus: album.albumInfo.finishStatus,
      intro: album.albumInfo.intro,
      rawJson: toJson(album),
    });

    await stageSnapshot(db, runId, "shelf_items", `album:${album.albumInfo.albumId}`, {
      itemType: "album",
      wereadAlbumId: album.albumInfo.albumId,
      titleSnapshot: album.albumInfo.name ?? "未知专辑",
      authorSnapshot: album.albumInfo.authorName,
      coverSnapshot: album.albumInfo.cover,
      categorySnapshot: null,
      isTop: album.albumInfoExtra?.isTop ?? 0,
      isSecret: album.albumInfoExtra?.secret ?? 0,
      finishReading: 0,
      readUpdateTime: album.albumInfoExtra?.lectureReadUpdateTime,
      sourceUpdateTime: album.albumInfo.updateTime,
      rawJson: toJson(album),
    });
  }
}

async function getChangedNotebooks(client: WereadClient, checkpoint: number | null): Promise<NotebookSyncItem[]> {
  const results: NotebookSyncItem[] = [];
  let lastSort: number | undefined;

  while (true) {
    const page = await client.getNotebooks({
      count: 50,
      ...(lastSort ? { lastSort } : {}),
    });

    const booksOnPage = page.books?.map((item) => ({
      bookId: item.bookId,
      title: item.book?.title ?? "未知书籍",
      author: item.book?.author ?? "",
      cover: item.book?.cover ?? "",
      reviewCount: item.reviewCount ?? 0,
      noteCount: item.noteCount ?? 0,
      bookmarkCount: item.bookmarkCount ?? 0,
      totalCount: (item.reviewCount ?? 0) + (item.noteCount ?? 0) + (item.bookmarkCount ?? 0),
      readingProgress: item.readingProgress ?? null,
      markedStatus: item.markedStatus ?? null,
      sort: item.sort ?? 0,
      rawJson: toJson(item),
    })) ?? [];

    results.push(...booksOnPage);

    if (checkpoint !== null && booksOnPage.some((item) => item.sort <= checkpoint)) {
      return results.filter((item) => item.sort > checkpoint);
    }

    if (page.hasMore !== 1 || booksOnPage.length === 0) break;
    lastSort = booksOnPage.at(-1)?.sort;
    if (!lastSort) break;
  }

  return results;
}

async function stageNotebooks(db: AppDb, runId: number, notebooks: NotebookSyncItem[], stagedBookIds: Set<string>) {
  for (const notebook of notebooks) {
    await stageBook(db, runId, {
      wereadBookId: notebook.bookId,
      title: notebook.title,
      author: notebook.author,
      cover: notebook.cover,
      rawJson: notebook.rawJson,
    }, stagedBookIds);

    await stageSnapshot(db, runId, "notebook_books", notebook.bookId, {
      wereadBookId: notebook.bookId,
      reviewCount: notebook.reviewCount,
      noteCount: notebook.noteCount,
      bookmarkCount: notebook.bookmarkCount,
      totalCount: notebook.totalCount,
      readingProgress: notebook.readingProgress,
      markedStatus: notebook.markedStatus,
      sort: notebook.sort,
      rawJson: notebook.rawJson,
    });
  }
}

async function stageBookDetailAndProgress(db: AppDb, client: WereadClient, runId: number, wereadBookId: string) {
  const detail = await client.getBookInfo({ bookId: wereadBookId });

  await stageSnapshot(db, runId, "book_info", wereadBookId, {
    wereadBookId,
    title: detail.title ?? "未知书籍",
    author: detail.author,
    translator: detail.translator,
    cover: detail.cover,
    intro: detail.intro,
    category: detail.category,
    publisher: detail.publisher,
    publishTime: detail.publishTime,
    isbn: detail.isbn,
    wordCount: detail.wordCount,
    rating: detail.newRating,
    ratingCount: detail.newRatingCount,
    ratingDetailJson: detail.newRatingDetail ? toJson(detail.newRatingDetail) : null,
    rawJson: toJson(detail),
  });

  await stageSnapshot(db, runId, "books", wereadBookId, {
    wereadBookId,
    title: detail.title ?? "未知书籍",
    author: detail.author,
    cover: detail.cover,
    intro: detail.intro,
    category: detail.category,
    publisher: detail.publisher,
    isbn: detail.isbn,
    wordCount: detail.wordCount,
    rating: detail.newRating,
    ratingCount: detail.newRatingCount,
    rawJson: toJson(detail),
  } satisfies BookSnapshot);

  const progress = await client.getProgress({ bookId: wereadBookId });
  await stageSnapshot(db, runId, "book_progress", wereadBookId, {
    wereadBookId,
    chapterUid: progress.book?.chapterUid,
    chapterOffset: progress.book?.chapterOffset,
    progress: progress.book?.progress,
    recordReadingTime: progress.book?.recordReadingTime,
    finishTime: progress.book?.finishTime,
    isStartReading: progress.book?.isStartReading,
    sourceUpdateTime: progress.book?.updateTime,
    sourceTimestamp: progress.timestamp,
    rawJson: toJson(progress),
  });
}

async function stageNotebookContent(db: AppDb, client: WereadClient, runId: number, wereadBookId: string) {
  const bookmarkPayload = await client.getBookmarkList({ bookId: wereadBookId });
  const reviewsPayload = await getAllMyReviews(client, wereadBookId);
  const chapterTitleMap = new Map((bookmarkPayload.chapters ?? []).map((chapter) => [chapter.chapterUid, chapter.title ?? null]));

  for (const item of bookmarkPayload.updated ?? []) {
    if (!item.markText) continue;

    const id = item.bookmarkId ?? `${wereadBookId}:${item.range ?? ""}:${item.createTime ?? 0}`;
    await stageSnapshot(db, runId, "highlights", id, {
      wereadBookId,
      wereadBookmarkId: id,
      chapterUid: item.chapterUid,
      chapterTitle: item.chapterUid ? chapterTitleMap.get(item.chapterUid) ?? null : null,
      range: item.range,
      markText: item.markText,
      colorStyle: item.colorStyle,
      createTime: item.createTime ?? 0,
      rawJson: toJson(item),
    });
  }

  for (const item of reviewsPayload) {
    if (!item.content) continue;

    const id = item.reviewId ?? `${wereadBookId}:${item.createTime ?? 0}:${item.content.slice(0, 16)}`;
    await stageSnapshot(db, runId, "reviews", id, {
      wereadBookId,
      wereadReviewId: id,
      chapterUid: item.chapterUid,
      chapterName: item.chapterName,
      range: item.range,
      abstract: item.abstract,
      content: item.content,
      star: item.star,
      isFinish: item.isFinish,
      reviewType: inferReviewType(item),
      createTime: item.createTime ?? 0,
      rawJson: toJson(item),
    });
  }
}

async function getAllMyReviews(client: WereadClient, bookId: string) {
  const allReviews: ReviewItem[] = [];
  let synckey = 0;

  while (true) {
    const page = await client.getMyReviews({ bookid: bookId, count: 50, synckey });
    const pageReviews = (page.reviews ?? [])
      .map((item) => item.review)
      .filter((review): review is ReviewItem => Boolean(review));
    allReviews.push(...pageReviews);
    if (page.hasMore !== 1 || !page.synckey) break;
    synckey = page.synckey;
  }

  return allReviews;
}

function inferReviewType(review: ReviewItem) {
  if (review.chapterName && review.abstract) return "thought";
  if (review.chapterName) return "chapter_review";
  if (review.isFinish !== undefined || (review.star ?? -1) >= 0) return "book_review";
  return "unknown";
}

async function stageReadingPeriods(
  db: AppDb,
  client: WereadClient,
  overall: ReadDataDetailResponse,
  runId: number,
  stagedBookIds: Set<string>,
  logger: SyncRunLogger,
) {
  const now = nowUnix();
  const startTime = overall.registTime ?? Math.floor(Date.UTC(new Date().getFullYear(), 0, 1) / 1000);
  const seenWeeks = new Set<number>();
  const progressTotal = estimateReadingPeriodCount(overall.registTime, now);
  let progressCurrent = 0;

  for (let time = now; time >= startTime; time -= 7 * 86400) {
    const weekly = await client.getReadData({ mode: "weekly", baseTime: time });
    if (!weekly.baseTime || seenWeeks.has(weekly.baseTime)) continue;

    seenWeeks.add(weekly.baseTime);
    await stageReadingPeriod(db, runId, "weekly", weekly, stagedBookIds);
    progressCurrent += 1;

    if (progressCurrent % 50 === 0) {
      await updateRun(db, runId, { progressCurrent, progressTotal, updatedAt: nowUnix() });
      await logger.info("reading_periods", `weekly snapshot 已写入 ${progressCurrent}/${progressTotal}`, {
        progressCurrent,
        progressTotal,
      });
    }
  }

  const start = new Date(startTime * 1000);
  const end = new Date(now * 1000);
  for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) {
    const startMonth = year === start.getFullYear() ? start.getMonth() : 0;
    const endMonth = year === end.getFullYear() ? end.getMonth() : 11;

    for (let month = startMonth; month <= endMonth; month += 1) {
      await stageReadingPeriod(db, runId, "monthly", await client.getReadData({
        mode: "monthly",
        baseTime: Math.floor(Date.UTC(year, month, 1) / 1000),
      }), stagedBookIds);
      progressCurrent += 1;

      if (month === endMonth || progressCurrent % 25 === 0) {
        await updateRun(db, runId, { progressCurrent, progressTotal, updatedAt: nowUnix() });
        await logger.info("reading_periods", `monthly snapshot 已写入到 ${year}-${String(month + 1).padStart(2, "0")}`, {
          progressCurrent,
          progressTotal,
        });
      }
    }
  }

  for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) {
    await stageReadingPeriod(db, runId, "annually", await client.getReadData({
      mode: "annually",
      baseTime: Math.floor(Date.UTC(year, 0, 1) / 1000),
    }), stagedBookIds);
    progressCurrent += 1;
    await updateRun(db, runId, { progressCurrent, progressTotal, updatedAt: nowUnix() });
    await logger.info("reading_periods", `annually snapshot 已写入 ${year}`, {
      progressCurrent,
      progressTotal,
    });
  }

  await stageReadingPeriod(db, runId, "overall", overall, stagedBookIds);
}

async function stageReadingPeriod(
  db: AppDb,
  runId: number,
  periodType: string,
  payload: ReadDataDetailResponse,
  stagedBookIds: Set<string>,
) {
  const baseTime = payload.baseTime ?? 0;
  const periodStart = getPeriodStartKey(periodType, baseTime);
  const periodEnd = getPeriodEndKey(periodType, baseTime);
  const periodKey = `${periodType}:${periodStart}`;

  await stageSnapshot(db, runId, "reading_periods", periodKey, {
    periodType,
    periodStart,
    periodEnd,
    baseTime,
    totalReadTime: payload.totalReadTime ?? 0,
    readDays: payload.readDays ?? 0,
    dayAverageReadTime: payload.dayAverageReadTime ?? 0,
    compare: payload.compare !== undefined ? Math.round(payload.compare * 10000) : null,
    readTimesJson: payload.readTimes ? toJson(payload.readTimes) : null,
    readStatJson: payload.readStat ? toJson(payload.readStat) : null,
    rawJson: toJson(payload),
  });

  for (const [index, item] of (payload.readLongest ?? []).entries()) {
    await stageReadingPeriodBook(db, runId, periodKey, index + 1, item, stagedBookIds);
  }
}

async function stageReadingPeriodBook(
  db: AppDb,
  runId: number,
  periodKey: string,
  rank: number,
  item: ReadDataLongestItem,
  stagedBookIds: Set<string>,
) {
  if (item.book?.bookId) {
    await stageBook(db, runId, bookFromReadData(item.book), stagedBookIds);
  }
  if (item.albumInfo?.albumId) {
    await stageAlbum(db, runId, albumFromReadData(item.albumInfo));
  }

  await stageSnapshot(db, runId, "reading_period_books", `${periodKey}:${rank}`, {
    periodKey,
    rank,
    wereadBookId: item.book?.bookId ?? null,
    wereadAlbumId: item.albumInfo?.albumId ?? null,
    readTime: item.readTime ?? 0,
    recordReadingTime: item.recordReadingTime ?? 0,
    tagsJson: toJson(item.tags ?? []),
    titleSnapshot: item.book?.title ?? item.albumInfo?.name ?? "未知条目",
    authorSnapshot: item.book?.author ?? item.albumInfo?.authorName,
    coverSnapshot: item.book?.cover ?? item.albumInfo?.cover,
    rawJson: toJson(item),
  });
}

function bookFromReadData(book: NonNullable<ReadDataLongestItem["book"]>): BookSnapshot {
  const raw = book as Record<string, unknown>;
  return {
    wereadBookId: book.bookId ?? "",
    title: book.title ?? "未知书籍",
    author: book.author,
    cover: book.cover,
    intro: typeof raw.intro === "string" ? raw.intro : null,
    rawJson: toJson(book),
  };
}

function albumFromReadData(album: NonNullable<ReadDataLongestItem["albumInfo"]>): AlbumSnapshot {
  return {
    wereadAlbumId: album.albumId ?? "",
    name: album.name ?? "未知专辑",
    authorName: album.authorName,
    cover: album.cover,
    rawJson: toJson(album),
  };
}

function estimateReadingPeriodCount(registTime: number | undefined, now: number) {
  const start = registTime ?? Math.floor(Date.UTC(new Date().getFullYear(), 0, 1) / 1000);
  const weeks = Math.ceil((now - start) / (7 * 86400));
  const startDate = new Date(start * 1000);
  const endDate = new Date(now * 1000);
  const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 + endDate.getMonth() - startDate.getMonth() + 1;
  const years = endDate.getFullYear() - startDate.getFullYear() + 1;
  return weeks + months + years + 1;
}

function getPeriodStartKey(periodType: string, baseTime: number) {
  if (periodType === "overall") return "overall";
  if (periodType === "annually") return String(getShanghaiDateParts(baseTime).year);
  if (periodType === "monthly") {
    const parts = getShanghaiDateParts(baseTime);
    return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
  }
  return formatShanghaiDate(baseTime);
}

function getPeriodEndKey(periodType: string, baseTime: number) {
  if (periodType === "overall") return null;

  const start = new Date(baseTime * 1000);
  if (periodType === "weekly") {
    start.setUTCDate(start.getUTCDate() + 6);
    return formatShanghaiDate(Math.floor(start.getTime() / 1000));
  }
  if (periodType === "monthly") {
    const parts = getShanghaiDateParts(baseTime);
    return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
  }
  return String(getShanghaiDateParts(baseTime).year);
}

function formatShanghaiDate(timestamp: number) {
  const parts = getShanghaiDateParts(timestamp);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getShanghaiDateParts(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp * 1000));

  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
}

async function stageReadingYear(
  db: AppDb,
  runId: number,
  year: number,
  annual: ReadDataDetailResponse,
  stagedBookIds: Set<string>,
) {
  await stageSnapshot(db, runId, "reading_years", String(year), {
    year,
    totalReadTime: annual.totalReadTime ?? 0,
    readDays: annual.readDays ?? 0,
    dayAverageReadTime: annual.dayAverageReadTime ?? 0,
    compare: annual.compare !== undefined ? Math.round(annual.compare * 10000) : null,
    rawJson: toJson(annual),
  });

  for (const [index, top] of (annual.readLongest ?? []).entries()) {
    if (top.book?.bookId) {
      await stageBook(db, runId, bookFromReadData(top.book), stagedBookIds);
    }
    if (top.albumInfo?.albumId) {
      await stageAlbum(db, runId, albumFromReadData(top.albumInfo));
    }
    await stageSnapshot(db, runId, "reading_top_books", `${year}:${index + 1}`, {
      year,
      rank: index + 1,
      wereadBookId: top.book?.bookId ?? null,
      wereadAlbumId: top.albumInfo?.albumId ?? null,
      readTime: top.readTime ?? 0,
      recordReadingTime: top.recordReadingTime ?? 0,
      tagsJson: toJson(top.tags ?? []),
      titleSnapshot: top.book?.title ?? top.albumInfo?.name ?? "未知条目",
      authorSnapshot: top.book?.author ?? top.albumInfo?.authorName,
      coverSnapshot: top.book?.cover ?? top.albumInfo?.cover,
    });
  }
}

async function stageReadingDaysForYear(db: AppDb, client: WereadClient, runId: number, year: number) {
  const annual = await client.getReadData({
    mode: "annually",
    baseTime: Math.floor(Date.UTC(year, 0, 1) / 1000),
  });

  if (annual.dailyReadTimes && Object.keys(annual.dailyReadTimes).length > 0) {
    for (const [timestamp, seconds] of Object.entries(annual.dailyReadTimes)) {
      const day = formatShanghaiDate(Number(timestamp));
      await stageReadingDay(db, runId, year, day, Number(seconds), "annual_daily");
    }
    return;
  }

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const buckets = (await client.getReadData({
      mode: "monthly",
      baseTime: Math.floor(Date.UTC(year, monthIndex, 1) / 1000),
    })).readTimes ?? {};

    for (const [timestamp, seconds] of Object.entries(buckets)) {
      const day = formatShanghaiDate(Number(timestamp));
      await stageReadingDay(db, runId, year, day, Number(seconds), "monthly_rollup");
    }
  }
}

async function stageCurrentWeekReadingDays(
  db: AppDb,
  runId: number,
  weekly: ReadDataDetailResponse,
) {
  const baseTime = weekly.baseTime ?? nowUnix();
  const bucketMap = new Map<string, number>();
  for (const [timestamp, seconds] of Object.entries(weekly.readTimes ?? {})) {
    bucketMap.set(formatShanghaiDate(Number(timestamp)), Number(seconds));
  }

  const weekDays = Array.from({ length: 7 }, (_, index) => formatShanghaiDate(baseTime + index * ONE_DAY_SECONDS));
  for (const day of weekDays) {
    const year = Number(day.slice(0, 4));
    await stageReadingDay(db, runId, year, day, bucketMap.get(day) ?? 0, "weekly_current");
  }

  return weekDays.length;
}

async function stageReadingDay(
  db: AppDb,
  runId: number,
  year: number,
  day: string,
  readSeconds: number,
  source: string,
) {
  await stageSnapshot(db, runId, "reading_days", `${year}:${day}`, {
    year,
    day,
    readSeconds,
    source,
  });
}

async function commitStagedRun(db: AppDb, runId: number) {
  const snapshots = await db.select().from(syncSnapshots).where(eq(syncSnapshots.runId, runId));
  const byTarget = groupSnapshots(snapshots);
  const now = nowUnix();

  await db.transaction(async (tx) => {
    const bookIdMap = await commitBooks(tx, byTarget.get("books") ?? [], now);
    const albumIdMap = await commitAlbums(tx, byTarget.get("albums") ?? [], now);

    await commitShelfItems(tx, byTarget.get("shelf_items") ?? [], bookIdMap, albumIdMap, now);
    await commitNotebookBooks(tx, byTarget.get("notebook_books") ?? [], bookIdMap, now);
    await commitBookInfo(tx, byTarget.get("book_info") ?? [], bookIdMap, now);
    await commitBookProgress(tx, byTarget.get("book_progress") ?? [], bookIdMap, now);
    await commitNotebookContent(tx, byTarget.get("highlights") ?? [], byTarget.get("reviews") ?? [], bookIdMap, now);
    await commitReadingPeriods(tx, byTarget.get("reading_periods") ?? [], byTarget.get("reading_period_books") ?? [], bookIdMap, albumIdMap, now);
    await commitReadingYears(tx, byTarget.get("reading_years") ?? [], byTarget.get("reading_top_books") ?? [], bookIdMap, albumIdMap, now);
    await commitReadingDays(tx, byTarget.get("reading_days") ?? [], now);
    await rebuildReadBooks(tx, now);
    await commitCursors(tx, byTarget.get("sync_cursors") ?? [], now);
  });
}

function groupSnapshots(rows: SnapshotRow[]) {
  const grouped = new Map<string, SnapshotRow[]>();
  for (const row of rows) {
    grouped.set(row.targetTable, [...(grouped.get(row.targetTable) ?? []), row]);
  }
  return grouped;
}

async function commitBooks(db: DbLike, rows: SnapshotRow[], now: number) {
  const values = rows.map((row) => {
    const item = parseSnapshot<BookSnapshot>(row);
    return {
      wereadBookId: item.wereadBookId,
      title: item.title,
      author: item.author,
      cover: item.cover,
      intro: item.intro,
      category: item.category,
      publisher: item.publisher,
      isbn: item.isbn,
      wordCount: item.wordCount,
      rating: item.rating,
      ratingCount: item.ratingCount,
      rawJson: item.rawJson,
      updatedAt: now,
    };
  });

  for (const chunk of chunkArray(values, 10)) {
    await db
      .insert(books)
      .values(chunk)
      .onConflictDoUpdate({
        target: books.wereadBookId,
        set: {
          title: sql.raw("excluded.title"),
          author: sql.raw("excluded.author"),
          cover: sql.raw("excluded.cover"),
          intro: sql.raw("excluded.intro"),
          category: sql.raw("excluded.category"),
          publisher: sql.raw("excluded.publisher"),
          isbn: sql.raw("excluded.isbn"),
          wordCount: sql.raw("excluded.word_count"),
          rating: sql.raw("excluded.rating"),
          ratingCount: sql.raw("excluded.rating_count"),
          rawJson: sql.raw("excluded.raw_json"),
          updatedAt: sql.raw("excluded.updated_at"),
        },
      });
  }

  return loadBookIdMap(db);
}

async function commitAlbums(db: DbLike, rows: SnapshotRow[], now: number) {
  const values = rows.map((row) => {
    const item = parseSnapshot<AlbumSnapshot>(row);
    return {
      wereadAlbumId: item.wereadAlbumId,
      name: item.name,
      authorName: item.authorName,
      cover: item.cover,
      trackCount: item.trackCount,
      finishStatus: item.finishStatus,
      intro: item.intro,
      rawJson: item.rawJson,
      updatedAt: now,
    };
  });

  for (const chunk of chunkArray(values, 10)) {
    await db
      .insert(albums)
      .values(chunk)
      .onConflictDoUpdate({
        target: albums.wereadAlbumId,
        set: {
          name: sql.raw("excluded.name"),
          authorName: sql.raw("excluded.author_name"),
          cover: sql.raw("excluded.cover"),
          trackCount: sql.raw("excluded.track_count"),
          finishStatus: sql.raw("excluded.finish_status"),
          intro: sql.raw("excluded.intro"),
          rawJson: sql.raw("excluded.raw_json"),
          updatedAt: sql.raw("excluded.updated_at"),
        },
      });
  }

  return loadAlbumIdMap(db);
}

async function loadBookIdMap(db: DbLike) {
  const rows = await db.select({ id: books.id, wereadBookId: books.wereadBookId }).from(books);
  return new Map(rows.map((row) => [row.wereadBookId, row.id]));
}

async function loadAlbumIdMap(db: DbLike) {
  const rows = await db.select({ id: albums.id, wereadAlbumId: albums.wereadAlbumId }).from(albums);
  return new Map(rows.map((row) => [row.wereadAlbumId, row.id]));
}

async function commitShelfItems(
  db: DbLike,
  rows: SnapshotRow[],
  bookIdMap: Map<string, number>,
  albumIdMap: Map<string, number>,
  now: number,
) {
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

  for (const chunk of chunkArray(values, 10)) {
    await db.insert(shelfItems).values(chunk);
  }
}

async function commitNotebookBooks(db: DbLike, rows: SnapshotRow[], bookIdMap: Map<string, number>, now: number) {
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

  for (const chunk of chunkArray(values, 10)) {
    await db
      .insert(notebookBooks)
      .values(chunk)
      .onConflictDoUpdate({
        target: notebookBooks.bookId,
        set: {
          reviewCount: sql.raw("excluded.review_count"),
          noteCount: sql.raw("excluded.note_count"),
          bookmarkCount: sql.raw("excluded.bookmark_count"),
          totalCount: sql.raw("excluded.total_count"),
          readingProgress: sql.raw("excluded.reading_progress"),
          markedStatus: sql.raw("excluded.marked_status"),
          sort: sql.raw("excluded.sort"),
          rawJson: sql.raw("excluded.raw_json"),
          updatedAt: sql.raw("excluded.updated_at"),
        },
      });
  }
}

async function commitBookInfo(db: DbLike, rows: SnapshotRow[], bookIdMap: Map<string, number>, now: number) {
  const values = rows.flatMap((row) => {
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
  });

  for (const chunk of chunkArray(values, 10)) {
    await db
      .insert(bookInfo)
      .values(chunk)
      .onConflictDoUpdate({
        target: bookInfo.bookId,
        set: {
          title: sql.raw("excluded.title"),
          author: sql.raw("excluded.author"),
          translator: sql.raw("excluded.translator"),
          cover: sql.raw("excluded.cover"),
          intro: sql.raw("excluded.intro"),
          category: sql.raw("excluded.category"),
          publisher: sql.raw("excluded.publisher"),
          publishTime: sql.raw("excluded.publish_time"),
          isbn: sql.raw("excluded.isbn"),
          wordCount: sql.raw("excluded.word_count"),
          rating: sql.raw("excluded.rating"),
          ratingCount: sql.raw("excluded.rating_count"),
          ratingDetailJson: sql.raw("excluded.rating_detail_json"),
          rawJson: sql.raw("excluded.raw_json"),
          updatedAt: sql.raw("excluded.updated_at"),
        },
      });
  }
}

async function commitBookProgress(db: DbLike, rows: SnapshotRow[], bookIdMap: Map<string, number>, now: number) {
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

  for (const chunk of chunkArray(values,10)) {
    await db
      .insert(bookProgress)
      .values(chunk)
      .onConflictDoUpdate({
        target: bookProgress.bookId,
        set: {
          chapterUid: sql.raw("excluded.chapter_uid"),
          chapterOffset: sql.raw("excluded.chapter_offset"),
          progress: sql.raw("excluded.progress"),
          recordReadingTime: sql.raw("excluded.record_reading_time"),
          finishTime: sql.raw("excluded.finish_time"),
          isStartReading: sql.raw("excluded.is_start_reading"),
          sourceUpdateTime: sql.raw("excluded.source_update_time"),
          sourceTimestamp: sql.raw("excluded.source_timestamp"),
          rawJson: sql.raw("excluded.raw_json"),
          updatedAt: sql.raw("excluded.updated_at"),
        },
      });
  }
}

async function commitNotebookContent(
  db: DbLike,
  highlightRows: SnapshotRow[],
  reviewRows: SnapshotRow[],
  bookIdMap: Map<string, number>,
  now: number,
) {
  const touchedBookIds = new Set<number>();
  for (const row of [...highlightRows, ...reviewRows]) {
    const item = parseSnapshot<Record<string, unknown>>(row);
    const bookId = typeof item.wereadBookId === "string" ? bookIdMap.get(item.wereadBookId) : undefined;
    if (bookId) touchedBookIds.add(bookId);
  }

  const ids = [...touchedBookIds];
  if (ids.length > 0) {
    await db.delete(highlights).where(inArray(highlights.bookId, ids));
    await db.delete(reviews).where(inArray(reviews.bookId, ids));
  }

  const highlightValues = highlightRows.flatMap((row) => {
    const item = parseSnapshot<Record<string, unknown>>(row);
    const bookId = typeof item.wereadBookId === "string" ? bookIdMap.get(item.wereadBookId) : undefined;
    if (!bookId) return [];

    return [{
      bookId,
      wereadBookmarkId: String(item.wereadBookmarkId),
      chapterUid: typeof item.chapterUid === "number" ? item.chapterUid : null,
      chapterTitle: typeof item.chapterTitle === "string" ? item.chapterTitle : null,
      range: typeof item.range === "string" ? item.range : null,
      markText: String(item.markText ?? ""),
      colorStyle: typeof item.colorStyle === "number" ? item.colorStyle : null,
      createTime: Number(item.createTime ?? 0),
      rawJson: typeof item.rawJson === "string" ? item.rawJson : null,
      updatedAt: now,
    }];
  });

  for (const chunk of chunkArray(highlightValues, 200)) {
    await db.insert(highlights).values(chunk);
  }

  const reviewValues = reviewRows.flatMap((row) => {
    const item = parseSnapshot<Record<string, unknown>>(row);
    const bookId = typeof item.wereadBookId === "string" ? bookIdMap.get(item.wereadBookId) : undefined;
    if (!bookId) return [];

    return [{
      bookId,
      wereadReviewId: String(item.wereadReviewId),
      chapterUid: typeof item.chapterUid === "number" ? item.chapterUid : null,
      chapterName: typeof item.chapterName === "string" ? item.chapterName : null,
      range: typeof item.range === "string" ? item.range : null,
      abstract: typeof item.abstract === "string" ? item.abstract : null,
      content: String(item.content ?? ""),
      star: typeof item.star === "number" ? item.star : null,
      isFinish: typeof item.isFinish === "number" ? item.isFinish : null,
      reviewType: String(item.reviewType ?? "unknown"),
      createTime: Number(item.createTime ?? 0),
      rawJson: typeof item.rawJson === "string" ? item.rawJson : null,
      updatedAt: now,
    }];
  });

  for (const chunk of chunkArray(reviewValues, 200)) {
    await db.insert(reviews).values(chunk);
  }
}

async function commitReadingPeriods(
  db: DbLike,
  periodRows: SnapshotRow[],
  bookRows: SnapshotRow[],
  bookIdMap: Map<string, number>,
  albumIdMap: Map<string, number>,
  now: number,
) {
  const periodIdMap = new Map<string, number>();
  const committedPeriodKeys = new Set<string>();
  const periodValues = periodRows.map((row) => {
    const item = parseSnapshot<Record<string, unknown>>(row);
    const periodType = String(item.periodType);
    const periodStart = String(item.periodStart);
    const periodKey = `${periodType}:${periodStart}`;
    committedPeriodKeys.add(periodKey);

    return {
      periodType,
      periodStart,
      periodEnd: typeof item.periodEnd === "string" ? item.periodEnd : null,
      baseTime: Number(item.baseTime ?? 0),
      totalReadTime: Number(item.totalReadTime ?? 0),
      readDays: Number(item.readDays ?? 0),
      dayAverageReadTime: Number(item.dayAverageReadTime ?? 0),
      compare: typeof item.compare === "number" ? item.compare : null,
      readTimesJson: typeof item.readTimesJson === "string" ? item.readTimesJson : null,
      readStatJson: typeof item.readStatJson === "string" ? item.readStatJson : null,
      rawJson: typeof item.rawJson === "string" ? item.rawJson : null,
      updatedAt: now,
    };
  });

  for (const chunk of chunkArray(periodValues, 200)) {
    await db
      .insert(readingPeriods)
      .values(chunk)
      .onConflictDoUpdate({
        target: [readingPeriods.periodType, readingPeriods.periodStart],
        set: {
          periodEnd: sql.raw("excluded.period_end"),
          baseTime: sql.raw("excluded.base_time"),
          totalReadTime: sql.raw("excluded.total_read_time"),
          readDays: sql.raw("excluded.read_days"),
          dayAverageReadTime: sql.raw("excluded.day_average_read_time"),
          compare: sql.raw("excluded.compare_basis_points"),
          readTimesJson: sql.raw("excluded.read_times_json"),
          readStatJson: sql.raw("excluded.read_stat_json"),
          rawJson: sql.raw("excluded.raw_json"),
          updatedAt: sql.raw("excluded.updated_at"),
        },
      });
  }

  for (const value of periodValues) {
    const [period] = await db
      .select()
      .from(readingPeriods)
      .where(and(eq(readingPeriods.periodType, value.periodType), eq(readingPeriods.periodStart, value.periodStart)))
      .limit(1);
    if (period) periodIdMap.set(`${value.periodType}:${value.periodStart}`, period.id);
  }

  const committedPeriodIds = [...periodIdMap.values()];
  if (committedPeriodIds.length > 0) {
    await db.delete(readingPeriodBooks).where(inArray(readingPeriodBooks.periodId, committedPeriodIds));
  }

  const periodBookValues = bookRows.flatMap((row) => {
    const item = parseSnapshot<Record<string, unknown>>(row);
    const periodKey = String(item.periodKey);
    if (!committedPeriodKeys.has(periodKey)) return [];
    const periodId = periodIdMap.get(periodKey);
    if (!periodId) return [];

    return [{
      periodId,
      bookId: typeof item.wereadBookId === "string" ? bookIdMap.get(item.wereadBookId) ?? null : null,
      albumId: typeof item.wereadAlbumId === "string" ? albumIdMap.get(item.wereadAlbumId) ?? null : null,
      rank: Number(item.rank ?? 0),
      readTime: Number(item.readTime ?? 0),
      recordReadingTime: Number(item.recordReadingTime ?? 0),
      tagsJson: typeof item.tagsJson === "string" ? item.tagsJson : null,
      titleSnapshot: String(item.titleSnapshot ?? "未知条目"),
      authorSnapshot: typeof item.authorSnapshot === "string" ? item.authorSnapshot : null,
      coverSnapshot: typeof item.coverSnapshot === "string" ? item.coverSnapshot : null,
      rawJson: typeof item.rawJson === "string" ? item.rawJson : null,
      updatedAt: now,
    }];
  });

  for (const chunk of chunkArray(periodBookValues, 200)) {
    await db.insert(readingPeriodBooks).values(chunk);
  }
}

async function commitReadingYears(
  db: DbLike,
  yearRows: SnapshotRow[],
  topRows: SnapshotRow[],
  bookIdMap: Map<string, number>,
  albumIdMap: Map<string, number>,
  now: number,
) {
  const years = yearRows.map((row) => parseSnapshot<{ year: number }>(row).year);
  const yearValues = yearRows.map((row) => {
    const item = parseSnapshot<Record<string, unknown>>(row);
    return {
      year: Number(item.year),
      totalReadTime: Number(item.totalReadTime ?? 0),
      readDays: Number(item.readDays ?? 0),
      dayAverageReadTime: Number(item.dayAverageReadTime ?? 0),
      compare: typeof item.compare === "number" ? item.compare : null,
      rawJson: typeof item.rawJson === "string" ? item.rawJson : null,
      updatedAt: now,
    };
  });

  for (const chunk of chunkArray(yearValues, 200)) {
    await db
      .insert(readingYears)
      .values(chunk)
      .onConflictDoUpdate({
        target: readingYears.year,
        set: {
          totalReadTime: sql.raw("excluded.total_read_time"),
          readDays: sql.raw("excluded.read_days"),
          dayAverageReadTime: sql.raw("excluded.day_average_read_time"),
          compare: sql.raw("excluded.compare_basis_points"),
          rawJson: sql.raw("excluded.raw_json"),
          updatedAt: sql.raw("excluded.updated_at"),
        },
      });
  }

  if (years.length > 0) {
    await db.delete(readingTopBooks).where(inArray(readingTopBooks.year, years));
  }

  const topBookValues = topRows.map((row) => {
    const item = parseSnapshot<Record<string, unknown>>(row);
    return {
      year: Number(item.year),
      bookId: typeof item.wereadBookId === "string" ? bookIdMap.get(item.wereadBookId) ?? null : null,
      albumId: typeof item.wereadAlbumId === "string" ? albumIdMap.get(item.wereadAlbumId) ?? null : null,
      rank: Number(item.rank ?? 0),
      readTime: Number(item.readTime ?? 0),
      recordReadingTime: Number(item.recordReadingTime ?? 0),
      tagsJson: typeof item.tagsJson === "string" ? item.tagsJson : null,
      titleSnapshot: String(item.titleSnapshot ?? "未知条目"),
      authorSnapshot: typeof item.authorSnapshot === "string" ? item.authorSnapshot : null,
      coverSnapshot: typeof item.coverSnapshot === "string" ? item.coverSnapshot : null,
      updatedAt: now,
    };
  });

  for (const chunk of chunkArray(topBookValues, 200)) {
    await db.insert(readingTopBooks).values(chunk);
  }
}

async function commitReadingDays(db: DbLike, rows: SnapshotRow[], now: number) {
  const values = rows.map((row) => {
    const item = parseSnapshot<Record<string, unknown>>(row);
    return {
      year: Number(item.year),
      day: String(item.day),
      readSeconds: Number(item.readSeconds ?? 0),
      source: String(item.source ?? "unknown"),
      updatedAt: now,
    };
  });

  for (const chunk of chunkArray(values, 10)) {
    await db
      .insert(readingDays)
      .values(chunk)
      .onConflictDoUpdate({
        target: [readingDays.year, readingDays.day],
        set: {
          readSeconds: sql.raw("excluded.read_seconds"),
          source: sql.raw("excluded.source"),
          updatedAt: sql.raw("excluded.updated_at"),
        },
      });
  }
}

async function rebuildReadBooks(db: DbLike, now: number) {
  await db.delete(readBooks);

  const weeklyPeriods = await db.select().from(readingPeriods).where(eq(readingPeriods.periodType, "weekly"));
  const weeklyPeriodMap = new Map(weeklyPeriods.map((period) => [period.id, period]));
  const periodBooks = await db.select().from(readingPeriodBooks);
  const aggregate = new Map<number, { first: string; last: string; total: number; periods: Set<number> }>();

  for (const row of periodBooks) {
    if (!row.bookId) continue;

    const period = weeklyPeriodMap.get(row.periodId);
    if (!period) continue;

    const current = aggregate.get(row.bookId) ?? {
      first: period.periodStart,
      last: period.periodStart,
      total: 0,
      periods: new Set<number>(),
    };
    current.first = current.first < period.periodStart ? current.first : period.periodStart;
    current.last = current.last > period.periodStart ? current.last : period.periodStart;
    current.total += row.readTime;
    current.periods.add(period.id);
    aggregate.set(row.bookId, current);
  }

  const values = [...aggregate].map(([bookId, value]) => ({
      bookId,
      firstSeenPeriodStart: value.first,
      lastSeenPeriodStart: value.last,
      totalReadTime: value.total,
      seenPeriods: value.periods.size,
      source: "weekly_read_longest",
      updatedAt: now,
  }));

  for (const chunk of chunkArray(values, 10)) {
    await db.insert(readBooks).values(chunk);
  }
}

async function commitCursors(db: DbLike, rows: SnapshotRow[], now: number) {
  const values = rows.map((row) => {
    const item = parseSnapshot<{ key: string; value: string }>(row);
    return {
      key: item.key,
      value: item.value,
      updatedAt: now,
    };
  });

  for (const chunk of chunkArray(values, 30)) {
    await db
      .insert(syncCursors)
      .values(chunk)
      .onConflictDoUpdate({
        target: syncCursors.key,
        set: {
          value: sql.raw("excluded.value"),
          updatedAt: sql.raw("excluded.updated_at"),
        },
      });
  }
}

async function getCursor(db: AppDb, key: string) {
  const [row] = await db.select().from(syncCursors).where(eq(syncCursors.key, key)).limit(1);
  return row?.value ?? null;
}
