import type { ReadDataLongestItem, WereadClient } from "@repo/weread-api";

export type ReviewItem = NonNullable<NonNullable<Awaited<ReturnType<WereadClient["getMyReviews"]>>["reviews"]>[number]["review"]>;

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
  rawJson: unknown;
};

export type ReadDataBook = NonNullable<ReadDataLongestItem["book"]>;
export type ReadDataAlbum = NonNullable<ReadDataLongestItem["albumInfo"]>;
