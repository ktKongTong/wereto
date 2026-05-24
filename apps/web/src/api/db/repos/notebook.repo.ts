import { count, countDistinct, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/sqlite-core";

import { nowUnix } from "../../time.ts";
import type { DB } from "../client.ts";
import { books, highlights, notebookBooks, reviews, syncSnapshotHighlights, syncSnapshotNotebookBooks, syncSnapshotReviews } from "../schema.ts";
import { bulkInsertStatements, bulkUpsert, deleteWhereInStatements, executeStatementBatches } from "../utils/d1-bulk-writer.ts";

type SnapshotInput<T> = Omit<T, "id" | "runId" | "createdAt">;

export type NotebookBookSnapshotInput = SnapshotInput<typeof syncSnapshotNotebookBooks.$inferInsert>;
export type HighlightSnapshotInput = SnapshotInput<typeof syncSnapshotHighlights.$inferInsert>;
export type ReviewSnapshotInput = SnapshotInput<typeof syncSnapshotReviews.$inferInsert>;

export class NotebookRepo {
  constructor(private readonly db: DB) {}

  async clearSnapshots(runId: number) {
    await executeStatementBatches(this.db, [
      this.db.delete(syncSnapshotNotebookBooks).where(eq(syncSnapshotNotebookBooks.runId, runId)),
      this.db.delete(syncSnapshotHighlights).where(eq(syncSnapshotHighlights.runId, runId)),
      this.db.delete(syncSnapshotReviews).where(eq(syncSnapshotReviews.runId, runId)),
    ]);
  }

  async commitSnapshots(runId: number, bookIdMap: Map<string, number>, now: number) {
    const [notebookBookSnapshots, highlightSnapshots, reviewSnapshots] = await this.listCommitSnapshots(runId);
    await this.commitNotebookBooks(notebookBookSnapshots, bookIdMap, now);
    await this.replaceContentFromSnapshot(highlightSnapshots, reviewSnapshots, bookIdMap, now);
  }

  async listCommitSnapshots(runId: number) {
    return this.db.batch([
      this.db.select().from(syncSnapshotNotebookBooks).where(eq(syncSnapshotNotebookBooks.runId, runId)),
      this.db.select().from(syncSnapshotHighlights).where(eq(syncSnapshotHighlights.runId, runId)),
      this.db.select().from(syncSnapshotReviews).where(eq(syncSnapshotReviews.runId, runId)),
    ]);
  }

  async stageNotebookBooks(runId: number, rows: NotebookBookSnapshotInput[]) {
    const createdAt = nowUnix();
    await bulkUpsert(this.db, syncSnapshotNotebookBooks, [syncSnapshotNotebookBooks.runId, syncSnapshotNotebookBooks.wereadBookId], rows.map((row) => ({ runId, createdAt, ...row })));
  }

  async stageHighlights(runId: number, rows: HighlightSnapshotInput[]) {
    const createdAt = nowUnix();
    await bulkUpsert(this.db, syncSnapshotHighlights, [syncSnapshotHighlights.runId, syncSnapshotHighlights.wereadBookmarkId], rows.map((row) => ({ runId, createdAt, ...row })));
  }

  async stageReviews(runId: number, rows: ReviewSnapshotInput[]) {
    const createdAt = nowUnix();
    await bulkUpsert(this.db, syncSnapshotReviews, [syncSnapshotReviews.runId, syncSnapshotReviews.wereadReviewId], rows.map((row) => ({ runId, createdAt, ...row })));
  }

  async listStagedNotebookBookIds(runId: number) {
    const rows = await this.db
      .select({ wereadBookId: syncSnapshotNotebookBooks.wereadBookId })
      .from(syncSnapshotNotebookBooks)
      .where(eq(syncSnapshotNotebookBooks.runId, runId))
      .orderBy(desc(syncSnapshotNotebookBooks.sort));

    return rows.map((row) => row.wereadBookId);
  }

  async commitNotebookBooks(rows: Array<typeof syncSnapshotNotebookBooks.$inferSelect>, bookIdMap: Map<string, number>, now: number) {
    await this.upsertNotebookBooks(rows.flatMap((row) => {
      const bookId = bookIdMap.get(row.wereadBookId);
      if (!bookId) return [];
      const { id: _id, runId: _runId, createdAt: _createdAt, wereadBookId: _wereadBookId, ...rest } = row;
      return [{
        ...rest,
        bookId,
        rawJson: row.rawJson ?? null,
        updatedAt: now,
      }];
    }));
  }

  async replaceContentFromSnapshot(
    highlightRows: Array<typeof syncSnapshotHighlights.$inferSelect>,
    reviewRows: Array<typeof syncSnapshotReviews.$inferSelect>,
    bookIdMap: Map<string, number>,
    now: number,
  ) {
    const touchedBookIds = new Set<number>();
    const highlightValues = highlightRows.flatMap((row) => {
      const bookId = bookIdMap.get(row.wereadBookId);
      if (!bookId) return [];
      touchedBookIds.add(bookId);
      const { id: _id, runId: _runId, createdAt: _createdAt, wereadBookId: _wereadBookId, ...rest } = row;
      return [{
        ...rest,
        bookId,
        rawJson: row.rawJson ?? null,
        updatedAt: now,
      }];
    });
    const reviewValues = reviewRows.flatMap((row) => {
      const bookId = bookIdMap.get(row.wereadBookId);
      if (!bookId) return [];
      touchedBookIds.add(bookId);
      const { id: _id, runId: _runId, createdAt: _createdAt, wereadBookId: _wereadBookId, ...rest } = row;
      return [{
        ...rest,
        bookId,
        rawJson: row.rawJson ?? null,
        updatedAt: now,
      }];
    });

    await this.replaceNotebookContentByBookIds([...touchedBookIds], highlightValues, reviewValues);
  }

  async upsertNotebookBooks(values: Array<typeof notebookBooks.$inferInsert>) {
    await bulkUpsert(this.db, notebookBooks, notebookBooks.bookId, values);
  }

  async replaceNotebookContentByBookIds(
    bookIds: number[],
    highlightValues: Array<typeof highlights.$inferInsert>,
    reviewValues: Array<typeof reviews.$inferInsert>,
  ) {
    await executeStatementBatches(this.db, [
      ...deleteWhereInStatements(this.db, highlights, highlights.bookId, bookIds),
      ...deleteWhereInStatements(this.db, reviews, reviews.bookId, bookIds),
      ...bulkInsertStatements(this.db, highlights, highlightValues),
      ...bulkInsertStatements(this.db, reviews, reviewValues),
    ]);
  }

  async listNotebookBooks() {
    return this.db.select().from(notebookBooks).orderBy(desc(notebookBooks.totalCount), desc(notebookBooks.sort));
  }

  async listNotebookBookSummaries(limit: number) {
    return this.db
      .select({
        bookId: notebookBooks.bookId,
        wereadBookId: books.wereadBookId,
        title: books.title,
        author: books.author,
        cover: books.cover,
        reviewCount: notebookBooks.reviewCount,
        noteCount: notebookBooks.noteCount,
        bookmarkCount: notebookBooks.bookmarkCount,
        totalCount: notebookBooks.totalCount,
        sort: notebookBooks.sort,
      })
      .from(notebookBooks)
      .innerJoin(books, eq(books.id, notebookBooks.bookId))
      .orderBy(desc(notebookBooks.totalCount), desc(notebookBooks.sort))
      .limit(limit);
  }

  async listNotebookContentPreviews(bookIds: number[], limitPerBook: number) {
    if (bookIds.length === 0) return { highlights: [], reviews: [] };

    const highlightRank = sql<number>`row_number() over (partition by ${highlights.bookId} order by ${highlights.createTime} desc)`;
    const rankedHighlights = this.db
      .select({
        bookId: highlights.bookId,
        markText: highlights.markText,
        createTime: highlights.createTime,
        rank: highlightRank.as("rank"),
      })
      .from(highlights)
      .where(inArray(highlights.bookId, bookIds))
      .as("ranked_notebook_highlights");

    const reviewRank = sql<number>`row_number() over (partition by ${reviews.bookId} order by ${reviews.createTime} desc)`;
    const rankedReviews = this.db
      .select({
        bookId: reviews.bookId,
        content: reviews.content,
        chapterName: reviews.chapterName,
        createTime: reviews.createTime,
        rank: reviewRank.as("rank"),
      })
      .from(reviews)
      .where(inArray(reviews.bookId, bookIds))
      .as("ranked_notebook_reviews");

    const [highlightRows, reviewRows] = await this.db.batch([
      this.db
        .select({
          bookId: rankedHighlights.bookId,
          markText: rankedHighlights.markText,
          createTime: rankedHighlights.createTime,
        })
        .from(rankedHighlights)
        .where(lte(rankedHighlights.rank, limitPerBook))
        .orderBy(rankedHighlights.bookId, desc(rankedHighlights.createTime)),
      this.db
        .select({
          bookId: rankedReviews.bookId,
          content: rankedReviews.content,
          chapterName: rankedReviews.chapterName,
          createTime: rankedReviews.createTime,
        })
        .from(rankedReviews)
        .where(lte(rankedReviews.rank, limitPerBook))
        .orderBy(rankedReviews.bookId, desc(rankedReviews.createTime)),
    ]);

    return { highlights: highlightRows, reviews: reviewRows };
  }

  async listArchiveTimeline() {
    const highlightTimeline = this.db
      .select({
        type: sql<"highlight" | "review">`'highlight'`.as("type"),
        bookId: highlights.bookId,
        bookTitle: books.title,
        cover: books.cover,
        content: highlights.markText,
        createTime: highlights.createTime,
      })
      .from(highlights)
      .innerJoin(books, eq(books.id, highlights.bookId));

    const reviewTimeline = this.db
      .select({
        type: sql<"highlight" | "review">`'review'`.as("type"),
        bookId: reviews.bookId,
        bookTitle: books.title,
        cover: books.cover,
        content: reviews.content,
        createTime: reviews.createTime,
      })
      .from(reviews)
      .innerJoin(books, eq(books.id, reviews.bookId));

    const timeline = unionAll(reviewTimeline, highlightTimeline).as("archive_timeline");

    return this.db
      .select({
        type: timeline.type,
        bookId: timeline.bookId,
        bookTitle: timeline.bookTitle,
        cover: timeline.cover,
        content: timeline.content,
        createTime: timeline.createTime,
      })
      .from(timeline)
      .orderBy(desc(timeline.createTime));
  }

  async listAnnualAnnotationStats(years: number[]) {
    if (years.length === 0) return { highlightStats: [], reviewStats: [] };
    const highlightYear = sql<number>`cast(strftime('%Y', ${highlights.createTime}, 'unixepoch') as integer)`;
    const reviewYear = sql<number>`cast(strftime('%Y', ${reviews.createTime}, 'unixepoch') as integer)`;
    const [highlightStats, reviewStats] = await this.db.batch([
      this.db
        .select({
          year: highlightYear,
          highlights: count(),
          highlightBooks: countDistinct(highlights.bookId),
        })
        .from(highlights)
        .where(inArray(highlightYear, years))
        .groupBy(highlightYear),
      this.db
        .select({
          year: reviewYear,
          reviews: count(),
          reviewBooks: countDistinct(reviews.bookId),
        })
        .from(reviews)
        .where(inArray(reviewYear, years))
        .groupBy(reviewYear),
    ]);

    return { highlightStats, reviewStats };
  }

  async listAnnualHighlightPreviews(years: number[], limitPerYear: number) {
    if (years.length === 0) return [];
    const year = sql<number>`cast(strftime('%Y', ${highlights.createTime}, 'unixepoch') as integer)`;
    const rowNumber = sql<number>`row_number() over (partition by ${year} order by ${highlights.createTime} desc)`;
    const ranked = this.db
      .select({
        year: year.as("year"),
        bookTitle: books.title,
        cover: books.cover,
        content: highlights.markText,
        createTime: highlights.createTime,
        rank: rowNumber.as("rank"),
      })
      .from(highlights)
      .innerJoin(books, eq(books.id, highlights.bookId))
      .where(inArray(year, years))
      .as("ranked_highlights");

    return this.db
      .select({
        year: ranked.year,
        bookTitle: ranked.bookTitle,
        cover: ranked.cover,
        content: ranked.content,
        createTime: ranked.createTime,
      })
      .from(ranked)
      .where(lte(ranked.rank, limitPerYear))
      .orderBy(desc(ranked.year), desc(ranked.createTime));
  }

  async listAnnualReviewPreviews(years: number[], limitPerYear: number) {
    if (years.length === 0) return [];
    const year = sql<number>`cast(strftime('%Y', ${reviews.createTime}, 'unixepoch') as integer)`;
    const rowNumber = sql<number>`row_number() over (partition by ${year} order by ${reviews.createTime} desc)`;
    const ranked = this.db
      .select({
        year: year.as("year"),
        bookTitle: books.title,
        cover: books.cover,
        content: reviews.content,
        createTime: reviews.createTime,
        rank: rowNumber.as("rank"),
      })
      .from(reviews)
      .innerJoin(books, eq(books.id, reviews.bookId))
      .where(inArray(year, years))
      .as("ranked_reviews");

    return this.db
      .select({
        year: ranked.year,
        bookTitle: ranked.bookTitle,
        cover: ranked.cover,
        content: ranked.content,
        createTime: ranked.createTime,
      })
      .from(ranked)
      .where(lte(ranked.rank, limitPerYear))
      .orderBy(desc(ranked.year), desc(ranked.createTime));
  }
}
