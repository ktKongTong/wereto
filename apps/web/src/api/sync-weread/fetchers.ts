import type { WereadClient } from "@repo/weread-api";

import type { ReviewItem } from "./types.ts";
import { readingDayFromBucket, notebookFromApiItem } from "./mappers.ts";

export type BookDetailAndProgress = Awaited<ReturnType<typeof getBookDetailAndProgress>>;
export type NotebookContent = Awaited<ReturnType<typeof getNotebookContent>>;

export async function getBookDetailAndProgress(client: WereadClient, wereadBookId: string) {
  const [detail, progress] = await Promise.all([
    client.getBookInfo({ bookId: wereadBookId }),
    client.getProgress({ bookId: wereadBookId }),
  ]);
  return { wereadBookId, detail, progress };
}

export async function getChangedNotebooks(client: WereadClient, checkpoint: number | null) {
  const results = [];
  let lastSort: number | undefined;

  while (true) {
    const page = await client.getNotebooks({ count: 50, ...(lastSort ? { lastSort } : {}) });
    const booksOnPage = page.books?.map(notebookFromApiItem) ?? [];

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

export async function getNotebookContent(client: WereadClient, wereadBookId: string) {
  const [bookmarkPayload, reviewsPayload] = await Promise.all([
    client.getBookmarkList({ bookId: wereadBookId }),
    getAllMyReviews(client, wereadBookId),
  ]);
  return { wereadBookId, bookmarkPayload, reviewsPayload };
}

export async function getReadingDaysForYear(
  client: WereadClient,
  year: number,
  limit: <T>(callback: () => Promise<T>) => Promise<T>,
) {
  const annual = await client.getReadData({ mode: "annually", baseTime: Math.floor(Date.UTC(year, 0, 1) / 1000) });
  if (annual.dailyReadTimes && Object.keys(annual.dailyReadTimes).length > 0) {
    return Object.entries(annual.dailyReadTimes).map(([timestamp, seconds]) => readingDayFromBucket(year, timestamp, seconds, "annual_daily"));
  }

  const monthlyPayloads = await Promise.all(Array.from({ length: 12 }, (_, monthIndex) =>
    limit(() => client.getReadData({
      mode: "monthly",
      baseTime: Math.floor(Date.UTC(year, monthIndex, 1) / 1000),
    }))
  ));

  return monthlyPayloads.flatMap((payload) =>
    Object.entries(payload.readTimes ?? {}).map(([timestamp, seconds]) => readingDayFromBucket(year, timestamp, seconds, "monthly_rollup"))
  );
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
