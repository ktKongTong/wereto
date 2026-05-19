import type { WereadClient } from "@repo/weread-api";

import type { AppDb } from "../db/client.ts";
import { stageAlbumSnapshots, stageBookSnapshots, stageShelfItemSnapshots } from "./snapshot-bulk.ts";
import type { AlbumSnapshot, BookSnapshot } from "./types.ts";
import { stageSnapshot } from "./snapshots.ts";
import { toJson } from "./utils.ts";

export async function stageBook(db: AppDb, runId: number, book: BookSnapshot, stagedBookIds: Set<string>) {
  if (!book.wereadBookId) return;
  if (stagedBookIds.has(book.wereadBookId)) return;
  stagedBookIds.add(book.wereadBookId);
  await stageSnapshot(db, runId, "books", book.wereadBookId, book);
}

export async function stageAlbum(db: AppDb, runId: number, album: AlbumSnapshot) {
  if (!album.wereadAlbumId) return;
  await stageSnapshot(db, runId, "albums", album.wereadAlbumId, album);
}

export async function stageShelf(
  db: AppDb,
  runId: number,
  shelf: Awaited<ReturnType<WereadClient["getShelf"]>>,
  stagedBookIds: Set<string>,
) {
  const bookRows: Record<string, unknown>[] = [];
  const albumRows: Record<string, unknown>[] = [];
  const shelfRows: Record<string, unknown>[] = [];

  for (const item of shelf.books ?? []) {
    if (item.bookId && !stagedBookIds.has(item.bookId)) {
      stagedBookIds.add(item.bookId);
      bookRows.push({
        wereadBookId: item.bookId,
        title: item.title ?? "未知书籍",
        author: item.author,
        cover: item.cover,
        category: item.category,
        rawJson: toJson(item),
      });
    }

    shelfRows.push({
      entityKey: `book:${item.bookId}`,
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
    albumRows.push({
      wereadAlbumId: album.albumInfo.albumId,
      name: album.albumInfo.name ?? "未知专辑",
      authorName: album.albumInfo.authorName,
      cover: album.albumInfo.cover,
      trackCount: album.albumInfo.trackCount,
      finishStatus: album.albumInfo.finishStatus,
      intro: album.albumInfo.intro,
      rawJson: toJson(album),
    });

    shelfRows.push({
      entityKey: `album:${album.albumInfo.albumId}`,
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

  await stageBookSnapshots(db, runId, bookRows);
  await stageAlbumSnapshots(db, runId, albumRows);
  await stageShelfItemSnapshots(db, runId, shelfRows);
}

export async function stageBookDetailAndProgress(db: AppDb, client: WereadClient, runId: number, wereadBookId: string) {
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
