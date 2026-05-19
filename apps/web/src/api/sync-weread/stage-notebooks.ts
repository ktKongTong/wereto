import type { WereadClient } from "@repo/weread-api";

import type { AppDb } from "../db/client.ts";
import { stageBook } from "./stage-books.ts";
import { stageHighlightSnapshots, stageReviewSnapshots, stageSnapshot } from "./snapshots.ts";
import type { NotebookSyncItem, ReviewItem } from "./types.ts";
import { toJson } from "./utils.ts";

export async function getChangedNotebooks(client: WereadClient, checkpoint: number | null): Promise<NotebookSyncItem[]> {
  const results: NotebookSyncItem[] = [];
  let lastSort: number | undefined;

  while (true) {
    const page = await client.getNotebooks({ count: 50, ...(lastSort ? { lastSort } : {}) });
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

export async function stageNotebooks(db: AppDb, runId: number, notebooks: NotebookSyncItem[], stagedBookIds: Set<string>) {
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

export async function stageNotebookContent(db: AppDb, client: WereadClient, runId: number, wereadBookId: string) {
  const bookmarkPayload = await client.getBookmarkList({ bookId: wereadBookId });
  const reviewsPayload = await getAllMyReviews(client, wereadBookId);
  const chapterTitleMap = new Map((bookmarkPayload.chapters ?? []).map((chapter) => [chapter.chapterUid, chapter.title ?? null]));
  const highlights = (bookmarkPayload.updated ?? []).flatMap((item) => {
    if (!item.markText) return [];
    const id = item.bookmarkId ?? `${wereadBookId}:${item.range ?? ""}:${item.createTime ?? 0}`;
    return [{
      wereadBookId,
      wereadBookmarkId: id,
      chapterUid: item.chapterUid,
      chapterTitle: item.chapterUid ? chapterTitleMap.get(item.chapterUid) ?? null : null,
      range: item.range,
      markText: item.markText,
      colorStyle: item.colorStyle,
      createTime: item.createTime ?? 0,
      rawJson: toJson(item),
    }];
  });
  await stageHighlightSnapshots(db, runId, highlights);

  const reviews = reviewsPayload.flatMap((item) => {
    if (!item.content) return [];
    const id = item.reviewId ?? `${wereadBookId}:${item.createTime ?? 0}:${item.content.slice(0, 16)}`;
    return [{
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
    }];
  });
  await stageReviewSnapshots(db, runId, reviews);
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
