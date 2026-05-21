import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export type JsonRecord = Record<string, unknown>;

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskType: text("task_type").notNull().default("weread_sync"),
    source: text("source").notNull(),
    status: text("status").notNull(),
    phase: text("phase").notNull().default("queued"),
    requestedAt: integer("requested_at").notNull().default(0),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
    updatedAt: integer("updated_at").notNull().default(0),
    progressCurrent: integer("progress_current").notNull().default(0),
    progressTotal: integer("progress_total").notNull().default(0),
    workflowInstanceId: text("workflow_instance_id"),
    errorMessage: text("error_message"),
    resultJson: text("result_json", { mode: "json" }).$type<JsonRecord | null>(),
    statsJson: text("stats_json", { mode: "json" }).$type<JsonRecord | null>(),
  },
  (table) => [
    index("sync_runs_source_idx").on(table.source, table.startedAt),
    index("sync_runs_status_idx").on(table.status, table.updatedAt),
  ],
);

export const syncCursors = sqliteTable("sync_cursors", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const syncRunLogs = sqliteTable(
  "sync_run_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id").notNull(),
    level: text("level").notNull().default("info"),
    phase: text("phase").notNull(),
    message: text("message").notNull(),
    progressCurrent: integer("progress_current"),
    progressTotal: integer("progress_total"),
    metaJson: text("meta_json", { mode: "json" }).$type<JsonRecord | null>(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("sync_run_logs_run_created_idx").on(table.runId, table.createdAt),
    index("sync_run_logs_level_idx").on(table.level),
  ],
);

const snapshotBase = {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").notNull(),
  createdAt: integer("created_at").notNull(),
};

export const syncSnapshotBooks = sqliteTable(
  "sync_snapshot_books",
  {
    ...snapshotBase,
    wereadBookId: text("weread_book_id").notNull(),
    title: text("title").notNull(),
    author: text("author"),
    cover: text("cover"),
    intro: text("intro"),
    category: text("category"),
    publisher: text("publisher"),
    isbn: text("isbn"),
    wordCount: integer("word_count"),
    rating: integer("rating"),
    ratingCount: integer("rating_count"),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
  },
  (table) => [uniqueIndex("sync_snapshot_books_run_book_idx").on(table.runId, table.wereadBookId)],
);

export const syncSnapshotAlbums = sqliteTable(
  "sync_snapshot_albums",
  {
    ...snapshotBase,
    wereadAlbumId: text("weread_album_id").notNull(),
    name: text("name").notNull(),
    authorName: text("author_name"),
    cover: text("cover"),
    trackCount: integer("track_count"),
    finishStatus: text("finish_status"),
    intro: text("intro"),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
  },
  (table) => [uniqueIndex("sync_snapshot_albums_run_album_idx").on(table.runId, table.wereadAlbumId)],
);

export const syncSnapshotShelfItems = sqliteTable(
  "sync_snapshot_shelf_items",
  {
    ...snapshotBase,
    entityKey: text("entity_key").notNull(),
    itemType: text("item_type").notNull(),
    wereadBookId: text("weread_book_id"),
    wereadAlbumId: text("weread_album_id"),
    title: text("title_snapshot").notNull(),
    author: text("author_snapshot"),
    cover: text("cover_snapshot"),
    category: text("category_snapshot"),
    isTop: integer("is_top").notNull().default(0),
    isSecret: integer("is_secret").notNull().default(0),
    finishReading: integer("finish_reading").notNull().default(0),
    readUpdateTime: integer("read_update_time"),
    sourceUpdateTime: integer("source_update_time"),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
  },
  (table) => [uniqueIndex("sync_snapshot_shelf_items_run_key_idx").on(table.runId, table.entityKey)],
);

export const syncSnapshotNotebookBooks = sqliteTable(
  "sync_snapshot_notebook_books",
  {
    ...snapshotBase,
    wereadBookId: text("weread_book_id").notNull(),
    reviewCount: integer("review_count").notNull().default(0),
    noteCount: integer("note_count").notNull().default(0),
    bookmarkCount: integer("bookmark_count").notNull().default(0),
    totalCount: integer("total_count").notNull().default(0),
    readingProgress: integer("reading_progress"),
    markedStatus: integer("marked_status"),
    sort: integer("sort").notNull().default(0),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
  },
  (table) => [uniqueIndex("sync_snapshot_notebook_books_run_book_idx").on(table.runId, table.wereadBookId)],
);

export const syncSnapshotBookInfo = sqliteTable(
  "sync_snapshot_book_info",
  {
    ...snapshotBase,
    wereadBookId: text("weread_book_id").notNull(),
    title: text("title").notNull(),
    author: text("author"),
    translator: text("translator"),
    cover: text("cover"),
    intro: text("intro"),
    category: text("category"),
    publisher: text("publisher"),
    publishTime: text("publish_time"),
    isbn: text("isbn"),
    wordCount: integer("word_count"),
    rating: integer("rating"),
    ratingCount: integer("rating_count"),
    ratingDetailJson: text("rating_detail_json", { mode: "json" }).$type<JsonRecord | null>(),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
  },
  (table) => [uniqueIndex("sync_snapshot_book_info_run_book_idx").on(table.runId, table.wereadBookId)],
);

export const syncSnapshotBookProgress = sqliteTable(
  "sync_snapshot_book_progress",
  {
    ...snapshotBase,
    wereadBookId: text("weread_book_id").notNull(),
    chapterUid: integer("chapter_uid"),
    chapterOffset: integer("chapter_offset"),
    progress: integer("progress"),
    recordReadingTime: integer("record_reading_time"),
    finishTime: integer("finish_time"),
    isStartReading: integer("is_start_reading"),
    sourceUpdateTime: integer("source_update_time"),
    sourceTimestamp: integer("source_timestamp"),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
  },
  (table) => [uniqueIndex("sync_snapshot_book_progress_run_book_idx").on(table.runId, table.wereadBookId)],
);

export const syncSnapshotHighlights = sqliteTable(
  "sync_snapshot_highlights",
  {
    ...snapshotBase,
    wereadBookId: text("weread_book_id").notNull(),
    wereadBookmarkId: text("weread_bookmark_id").notNull(),
    chapterUid: integer("chapter_uid"),
    chapterTitle: text("chapter_title"),
    range: text("range"),
    markText: text("mark_text").notNull(),
    colorStyle: integer("color_style"),
    createTime: integer("create_time").notNull(),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
  },
  (table) => [uniqueIndex("sync_snapshot_highlights_run_bookmark_idx").on(table.runId, table.wereadBookmarkId)],
);

export const syncSnapshotReviews = sqliteTable(
  "sync_snapshot_reviews",
  {
    ...snapshotBase,
    wereadBookId: text("weread_book_id").notNull(),
    wereadReviewId: text("weread_review_id").notNull(),
    chapterUid: integer("chapter_uid"),
    chapterName: text("chapter_name"),
    range: text("range"),
    abstract: text("abstract"),
    content: text("content").notNull(),
    star: integer("star"),
    isFinish: integer("is_finish"),
    reviewType: text("review_type").notNull().default("unknown"),
    createTime: integer("create_time").notNull(),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
  },
  (table) => [uniqueIndex("sync_snapshot_reviews_run_review_idx").on(table.runId, table.wereadReviewId)],
);

export const syncSnapshotReadingPeriods = sqliteTable(
  "sync_snapshot_reading_periods",
  {
    ...snapshotBase,
    periodType: text("period_type").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end"),
    baseTime: integer("base_time").notNull(),
    totalReadTime: integer("total_read_time").notNull().default(0),
    readDays: integer("read_days").notNull().default(0),
    dayAverageReadTime: integer("day_average_read_time").notNull().default(0),
    compare: integer("compare_basis_points"),
    readTimesJson: text("read_times_json", { mode: "json" }).$type<Record<string, number> | null>(),
    readStatJson: text("read_stat_json", { mode: "json" }).$type<unknown | null>(),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
  },
  (table) => [uniqueIndex("sync_snapshot_reading_periods_run_period_idx").on(table.runId, table.periodType, table.periodStart)],
);

export const syncSnapshotReadingPeriodBooks = sqliteTable(
  "sync_snapshot_reading_period_books",
  {
    ...snapshotBase,
    periodKey: text("period_key").notNull(),
    wereadBookId: text("weread_book_id"),
    wereadAlbumId: text("weread_album_id"),
    rank: integer("rank").notNull(),
    readTime: integer("read_time").notNull().default(0),
    recordReadingTime: integer("record_reading_time").notNull().default(0),
    tagsJson: text("tags_json", { mode: "json" }).$type<string[]>(),
    title: text("title_snapshot").notNull(),
    author: text("author_snapshot"),
    cover: text("cover_snapshot"),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
  },
  (table) => [uniqueIndex("sync_snapshot_reading_period_books_run_period_rank_idx").on(table.runId, table.periodKey, table.rank)],
);

export const syncSnapshotReadingYears = sqliteTable(
  "sync_snapshot_reading_years",
  {
    ...snapshotBase,
    year: integer("year").notNull(),
    totalReadTime: integer("total_read_time").notNull().default(0),
    readDays: integer("read_days").notNull().default(0),
    dayAverageReadTime: integer("day_average_read_time").notNull().default(0),
    compare: integer("compare_basis_points"),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
  },
  (table) => [uniqueIndex("sync_snapshot_reading_years_run_year_idx").on(table.runId, table.year)],
);

export const syncSnapshotReadingTopBooks = sqliteTable(
  "sync_snapshot_reading_top_books",
  {
    ...snapshotBase,
    year: integer("year").notNull(),
    wereadBookId: text("weread_book_id"),
    wereadAlbumId: text("weread_album_id"),
    rank: integer("rank").notNull(),
    readTime: integer("read_time").notNull().default(0),
    recordReadingTime: integer("record_reading_time").notNull().default(0),
    tagsJson: text("tags_json", { mode: "json" }).$type<string[]>(),
    title: text("title_snapshot").notNull(),
    author: text("author_snapshot"),
    cover: text("cover_snapshot"),
  },
  (table) => [uniqueIndex("sync_snapshot_reading_top_books_run_year_rank_idx").on(table.runId, table.year, table.rank)],
);

export const syncSnapshotReadingDays = sqliteTable(
  "sync_snapshot_reading_days",
  {
    ...snapshotBase,
    year: integer("year").notNull(),
    day: text("day").notNull(),
    readSeconds: integer("read_seconds").notNull().default(0),
    source: text("source").notNull(),
  },
  (table) => [uniqueIndex("sync_snapshot_reading_days_run_day_idx").on(table.runId, table.year, table.day)],
);

export const syncSnapshotCursors = sqliteTable(
  "sync_snapshot_cursors",
  {
    ...snapshotBase,
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (table) => [uniqueIndex("sync_snapshot_cursors_run_key_idx").on(table.runId, table.key)],
);

export const appConfig = sqliteTable("app_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const books = sqliteTable(
  "books",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    wereadBookId: text("weread_book_id").notNull(),
    title: text("title").notNull(),
    author: text("author"),
    cover: text("cover"),
    intro: text("intro"),
    category: text("category"),
    publisher: text("publisher"),
    isbn: text("isbn"),
    wordCount: integer("word_count"),
    rating: integer("rating"),
    ratingCount: integer("rating_count"),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("books_weread_book_id_idx").on(table.wereadBookId),
    index("books_title_idx").on(table.title),
    index("books_author_idx").on(table.author),
  ],
);

export const albums = sqliteTable(
  "albums",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    wereadAlbumId: text("weread_album_id").notNull(),
    name: text("name").notNull(),
    authorName: text("author_name"),
    cover: text("cover"),
    trackCount: integer("track_count"),
    finishStatus: text("finish_status"),
    intro: text("intro"),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("albums_weread_album_id_idx").on(table.wereadAlbumId)],
);

export const shelfItems = sqliteTable(
  "shelf_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemType: text("item_type").notNull(),
    bookId: integer("book_id"),
    albumId: integer("album_id"),
    title: text("title_snapshot").notNull(),
    author: text("author_snapshot"),
    cover: text("cover_snapshot"),
    category: text("category_snapshot"),
    isTop: integer("is_top").notNull().default(0),
    isSecret: integer("is_secret").notNull().default(0),
    finishReading: integer("finish_reading").notNull().default(0),
    readUpdateTime: integer("read_update_time"),
    sourceUpdateTime: integer("source_update_time"),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("shelf_items_type_idx").on(table.itemType),
    index("shelf_items_read_update_time_idx").on(table.readUpdateTime),
  ],
);

export const notebookBooks = sqliteTable(
  "notebook_books",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id").notNull(),
    reviewCount: integer("review_count").notNull().default(0),
    noteCount: integer("note_count").notNull().default(0),
    bookmarkCount: integer("bookmark_count").notNull().default(0),
    totalCount: integer("total_count").notNull().default(0),
    readingProgress: integer("reading_progress"),
    markedStatus: integer("marked_status"),
    sort: integer("sort").notNull().default(0),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("notebook_books_book_id_idx").on(table.bookId),
    index("notebook_books_total_count_idx").on(table.totalCount),
    index("notebook_books_sort_idx").on(table.sort),
  ],
);

export const bookInfo = sqliteTable(
  "book_info",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id").notNull(),
    title: text("title").notNull(),
    author: text("author"),
    translator: text("translator"),
    cover: text("cover"),
    intro: text("intro"),
    category: text("category"),
    publisher: text("publisher"),
    publishTime: text("publish_time"),
    isbn: text("isbn"),
    wordCount: integer("word_count"),
    rating: integer("rating"),
    ratingCount: integer("rating_count"),
    ratingDetailJson: text("rating_detail_json", { mode: "json" }).$type<JsonRecord | null>(),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("book_info_book_id_idx").on(table.bookId),
    index("book_info_title_idx").on(table.title),
    index("book_info_author_idx").on(table.author),
  ],
);

export const bookProgress = sqliteTable(
  "book_progress",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id").notNull(),
    chapterUid: integer("chapter_uid"),
    chapterOffset: integer("chapter_offset"),
    progress: integer("progress"),
    recordReadingTime: integer("record_reading_time"),
    finishTime: integer("finish_time"),
    isStartReading: integer("is_start_reading"),
    sourceUpdateTime: integer("source_update_time"),
    sourceTimestamp: integer("source_timestamp"),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("book_progress_book_id_idx").on(table.bookId),
    index("book_progress_update_time_idx").on(table.sourceUpdateTime),
  ],
);

export const highlights = sqliteTable(
  "highlights",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id").notNull(),
    wereadBookmarkId: text("weread_bookmark_id").notNull(),
    chapterUid: integer("chapter_uid"),
    chapterTitle: text("chapter_title"),
    range: text("range"),
    markText: text("mark_text").notNull(),
    colorStyle: integer("color_style"),
    createTime: integer("create_time").notNull(),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("highlights_weread_bookmark_id_idx").on(table.wereadBookmarkId),
    index("highlights_book_id_create_time_idx").on(table.bookId, table.createTime),
  ],
);

export const reviews = sqliteTable(
  "reviews",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id").notNull(),
    wereadReviewId: text("weread_review_id").notNull(),
    chapterUid: integer("chapter_uid"),
    chapterName: text("chapter_name"),
    range: text("range"),
    abstract: text("abstract"),
    content: text("content").notNull(),
    star: integer("star"),
    isFinish: integer("is_finish"),
    reviewType: text("review_type").notNull().default("unknown"),
    createTime: integer("create_time").notNull(),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("reviews_weread_review_id_idx").on(table.wereadReviewId),
    index("reviews_book_id_create_time_idx").on(table.bookId, table.createTime),
    index("reviews_review_type_idx").on(table.reviewType),
  ],
);

export const readingYears = sqliteTable(
  "reading_years",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    year: integer("year").notNull(),
    totalReadTime: integer("total_read_time").notNull().default(0),
    readDays: integer("read_days").notNull().default(0),
    dayAverageReadTime: integer("day_average_read_time").notNull().default(0),
    compare: integer("compare_basis_points"),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("reading_years_year_idx").on(table.year)],
);

export const readingDays = sqliteTable(
  "reading_days",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    year: integer("year").notNull(),
    day: text("day").notNull(),
    readSeconds: integer("read_seconds").notNull().default(0),
    source: text("source").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("reading_days_year_day_idx").on(table.year, table.day),
    index("reading_days_year_read_seconds_idx").on(table.year, table.readSeconds),
  ],
);

export const readingTopBooks = sqliteTable(
  "reading_top_books",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    year: integer("year").notNull(),
    bookId: integer("book_id"),
    albumId: integer("album_id"),
    rank: integer("rank").notNull(),
    readTime: integer("read_time").notNull().default(0),
    recordReadingTime: integer("record_reading_time").notNull().default(0),
    tagsJson: text("tags_json", { mode: "json" }).$type<string[]>(),
    title: text("title_snapshot").notNull(),
    author: text("author_snapshot"),
    cover: text("cover_snapshot"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("reading_top_books_year_rank_idx").on(table.year, table.rank),
    index("reading_top_books_year_idx").on(table.year),
  ],
);

export const readingPeriods = sqliteTable(
  "reading_periods",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    periodType: text("period_type").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end"),
    baseTime: integer("base_time").notNull(),
    totalReadTime: integer("total_read_time").notNull().default(0),
    readDays: integer("read_days").notNull().default(0),
    dayAverageReadTime: integer("day_average_read_time").notNull().default(0),
    compare: integer("compare_basis_points"),
    readTimesJson: text("read_times_json", { mode: "json" }).$type<Record<string, number> | null>(),
    readStatJson: text("read_stat_json", { mode: "json" }).$type<unknown | null>(),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("reading_periods_type_start_idx").on(table.periodType, table.periodStart),
    index("reading_periods_type_base_time_idx").on(table.periodType, table.baseTime),
  ],
);

export const readingPeriodBooks = sqliteTable(
  "reading_period_books",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    periodId: integer("period_id").notNull(),
    bookId: integer("book_id"),
    albumId: integer("album_id"),
    rank: integer("rank").notNull(),
    readTime: integer("read_time").notNull().default(0),
    recordReadingTime: integer("record_reading_time").notNull().default(0),
    tagsJson: text("tags_json", { mode: "json" }).$type<string[]>(),
    title: text("title_snapshot").notNull(),
    author: text("author_snapshot"),
    cover: text("cover_snapshot"),
    rawJson: text("raw_json", { mode: "json" }).$type<unknown>(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("reading_period_books_period_rank_idx").on(table.periodId, table.rank),
    index("reading_period_books_book_idx").on(table.bookId),
    index("reading_period_books_album_idx").on(table.albumId),
  ],
);

export const readBooks = sqliteTable(
  "read_books",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id").notNull(),
    firstSeenPeriodStart: text("first_seen_period_start").notNull(),
    lastSeenPeriodStart: text("last_seen_period_start").notNull(),
    totalReadTime: integer("total_read_time").notNull().default(0),
    seenPeriods: integer("seen_periods").notNull().default(0),
    source: text("source").notNull().default("weekly_read_longest"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("read_books_book_id_idx").on(table.bookId),
    index("read_books_last_seen_idx").on(table.lastSeenPeriodStart),
    index("read_books_total_read_time_idx").on(table.totalReadTime),
  ],
);
