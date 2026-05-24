import { desc, eq, inArray, sql } from "drizzle-orm";

import { nowUnix } from "../../time.ts";
import type { DB } from "../client.ts";
import {
  albums,
  bookProgress,
  books,
  shelfItems,
  syncSnapshotAlbums,
  syncSnapshotBookProgress,
  syncSnapshotBooks,
  syncSnapshotShelfItems,
} from "../schema.ts";
import { bulkInsertStatements, bulkUpsert, chunkArray, executeStatementBatches, rowParamLimitedChunks, upsertOne } from "../utils/d1-bulk-writer.ts";

type SnapshotInput<T> = Omit<T, "id" | "runId" | "createdAt">;

export type BookSnapshotInput = SnapshotInput<typeof syncSnapshotBooks.$inferInsert>;
export type AlbumSnapshotInput = SnapshotInput<typeof syncSnapshotAlbums.$inferInsert>;
export type ShelfItemSnapshotInput = SnapshotInput<typeof syncSnapshotShelfItems.$inferInsert>;
export type BookProgressSnapshotInput = SnapshotInput<typeof syncSnapshotBookProgress.$inferInsert>;

export class CatalogRepo {
  constructor(private readonly db: DB) {}

  async clearSnapshots(runId: number) {
    await executeStatementBatches(this.db, [
      this.db.delete(syncSnapshotBooks).where(eq(syncSnapshotBooks.runId, runId)),
      this.db.delete(syncSnapshotAlbums).where(eq(syncSnapshotAlbums.runId, runId)),
      this.db.delete(syncSnapshotShelfItems).where(eq(syncSnapshotShelfItems.runId, runId)),
      this.db.delete(syncSnapshotBookProgress).where(eq(syncSnapshotBookProgress.runId, runId)),
    ]);
  }

  async commitSnapshots(runId: number, now: number) {
    const [bookSnapshots, albumSnapshots, shelfSnapshots, bookProgressSnapshots] = await this.listCommitSnapshots(runId);
    const bookIdMap = await this.commitBooks(bookSnapshots, now);
    const albumIdMap = await this.commitAlbums(albumSnapshots, now);
    await this.replaceShelfFromSnapshot(shelfSnapshots, bookIdMap, albumIdMap, now);
    await this.commitBookProgress(bookProgressSnapshots, bookIdMap, now);

    return { bookIdMap, albumIdMap };
  }

  async listCommitSnapshots(runId: number) {
    return this.db.batch([
      this.db.select().from(syncSnapshotBooks).where(eq(syncSnapshotBooks.runId, runId)),
      this.db.select().from(syncSnapshotAlbums).where(eq(syncSnapshotAlbums.runId, runId)),
      this.db.select().from(syncSnapshotShelfItems).where(eq(syncSnapshotShelfItems.runId, runId)),
      this.db.select().from(syncSnapshotBookProgress).where(eq(syncSnapshotBookProgress.runId, runId)),
    ]);
  }
  async getStagedBookIds(runId: number) {
    const rows = await this.db
      .select({ wereadBookId: syncSnapshotBooks.wereadBookId })
      .from(syncSnapshotBooks)
      .where(eq(syncSnapshotBooks.runId, runId));

    return new Set(rows.map((row) => row.wereadBookId));
  }

  async stageBooks(runId: number, rows: BookSnapshotInput[]) {
    const createdAt = nowUnix();
    await bulkUpsert(this.db, syncSnapshotBooks, [syncSnapshotBooks.runId, syncSnapshotBooks.wereadBookId], rows.map((row) => ({ runId, createdAt, ...row })));
  }

  async stageAlbums(runId: number, rows: AlbumSnapshotInput[]) {
    const createdAt = nowUnix();
    await bulkUpsert(this.db, syncSnapshotAlbums, [syncSnapshotAlbums.runId, syncSnapshotAlbums.wereadAlbumId], rows.map((row) => ({ runId, createdAt, ...row })));
  }

  async stageShelfItems(runId: number, rows: ShelfItemSnapshotInput[]) {
    const createdAt = nowUnix();
    await bulkUpsert(this.db, syncSnapshotShelfItems, [syncSnapshotShelfItems.runId, syncSnapshotShelfItems.entityKey], rows.map((row) => ({ runId, createdAt, ...row })));
  }


  async stageBookProgresses(runId: number, rows: BookProgressSnapshotInput[]) {
    const createdAt = nowUnix();
    await bulkUpsert(this.db, syncSnapshotBookProgress, [syncSnapshotBookProgress.runId, syncSnapshotBookProgress.wereadBookId], rows.map((row) => ({ runId, createdAt, ...row })));
  }

  async commitBooks(rows: Array<typeof syncSnapshotBooks.$inferSelect>, now: number) {
    await this.upsertBooks(rows.map(({ id: _id, runId: _runId, createdAt: _createdAt, ...row }) => ({
      ...row,
      rawJson: row.rawJson ?? null,
      updatedAt: now,
    })));
    return this.getBookIdMap();
  }

  async commitAlbums(rows: Array<typeof syncSnapshotAlbums.$inferSelect>, now: number) {
    await this.upsertAlbums(rows.map(({ id: _id, runId: _runId, createdAt: _createdAt, ...row }) => ({
      ...row,
      rawJson: row.rawJson ?? null,
      updatedAt: now,
    })));
    return this.getAlbumIdMap();
  }

  async replaceShelfFromSnapshot(
    rows: Array<typeof syncSnapshotShelfItems.$inferSelect>,
    bookIdMap: Map<string, number>,
    albumIdMap: Map<string, number>,
    now: number,
  ) {
    if (rows.length === 0) return;
    await this.replaceShelfItems(rows.map(({ id: _id, runId: _runId, createdAt: _createdAt, entityKey: _entityKey, wereadBookId, wereadAlbumId, ...row }) => ({
      ...row,
      bookId: wereadBookId ? bookIdMap.get(wereadBookId) ?? null : null,
      albumId: wereadAlbumId ? albumIdMap.get(wereadAlbumId) ?? null : null,
      rawJson: row.rawJson ?? null,
      updatedAt: now,
    })));
  }

  async commitBookProgress(rows: Array<typeof syncSnapshotBookProgress.$inferSelect>, bookIdMap: Map<string, number>, now: number) {
    await this.upsertBookProgressRows(rows.flatMap((row) => {
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

  async upsertBooks(values: Array<typeof books.$inferInsert>) {
    if (values.length === 0) return;
    await executeStatementBatches(this.db, rowParamLimitedChunks(values).map((chunk) =>
      this.db.insert(books).values(chunk).onConflictDoUpdate({
        target: books.wereadBookId,
        set: {
          title: sql`coalesce(nullif(excluded.title, ''), ${books.title})`,
          author: sql`coalesce(nullif(excluded.author, ''), ${books.author})`,
          translator: sql`coalesce(nullif(excluded.translator, ''), ${books.translator})`,
          cover: sql`coalesce(nullif(excluded.cover, ''), ${books.cover})`,
          intro: sql`coalesce(nullif(excluded.intro, ''), ${books.intro})`,
          category: sql`coalesce(nullif(excluded.category, ''), ${books.category})`,
          publisher: sql`coalesce(nullif(excluded.publisher, ''), ${books.publisher})`,
          publishTime: sql`coalesce(nullif(excluded.publish_time, ''), ${books.publishTime})`,
          isbn: sql`coalesce(nullif(excluded.isbn, ''), ${books.isbn})`,
          wordCount: sql`coalesce(excluded.word_count, ${books.wordCount})`,
          rating: sql`coalesce(excluded.rating, ${books.rating})`,
          ratingCount: sql`coalesce(excluded.rating_count, ${books.ratingCount})`,
          ratingDetailJson: sql`coalesce(excluded.rating_detail_json, ${books.ratingDetailJson})`,
          rawJson: sql`coalesce(excluded.raw_json, ${books.rawJson})`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
    ));
  }

  async upsertAlbums(values: Array<typeof albums.$inferInsert>) {
    await bulkUpsert(this.db, albums, albums.wereadAlbumId, values);
  }

  async getBookIdMap() {
    const rows = await this.db.select({ id: books.id, wereadBookId: books.wereadBookId }).from(books);
    return new Map(rows.map((row) => [row.wereadBookId, row.id]));
  }

  async getAlbumIdMap() {
    const rows = await this.db.select({ id: albums.id, wereadAlbumId: albums.wereadAlbumId }).from(albums);
    return new Map(rows.map((row) => [row.wereadAlbumId, row.id]));
  }

  async replaceShelfItems(values: Array<typeof shelfItems.$inferInsert>) {
    await executeStatementBatches(this.db, [
      this.db.delete(shelfItems),
      ...bulkInsertStatements(this.db, shelfItems, values),
    ]);
  }

  async upsertBookProgressRows(values: Array<typeof bookProgress.$inferInsert>) {
    await bulkUpsert(this.db, bookProgress, bookProgress.bookId, values);
  }

  async listShelfItems() {
    return this.db.select().from(shelfItems).orderBy(desc(shelfItems.readUpdateTime), desc(shelfItems.updatedAt));
  }

  async listAlbumsByIds(ids: number[]) {
    if (ids.length === 0) return [];
    const rows: Array<typeof albums.$inferSelect> = [];
    for (const chunk of chunkArray(ids, 100)) {
      rows.push(...await this.db.select().from(albums).where(inArray(albums.id, chunk)));
    }
    return rows;
  }

  async listBooksByIds(ids: number[]) {
    if (ids.length === 0) return [];
    const rows: Array<typeof books.$inferSelect> = [];
    for (const chunk of chunkArray(ids, 100)) {
      rows.push(...await this.db.select().from(books).where(inArray(books.id, chunk)));
    }
    return rows;
  }
}
