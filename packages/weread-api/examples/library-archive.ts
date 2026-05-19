import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";

import {
  createWereadClient,
  type BookmarkListItem,
  type NotebookBookItem,
  type PersonalReviewDetail,
  type ReviewListMineResponse,
  type ShelfAlbumItem,
  type ShelfBookItem,
} from "../src/index.ts";

loadEnvFile();

const OUTPUT_PATH = resolve("examples/output/library-archive.html");
const NOTEBOOK_LIMIT = 12;
const TIMELINE_LIMIT = 40;

async function main() {
  const client = createWereadClient({
    onRequest(request) {
      console.log("->", request.method, request.url);
    },
    onResponse(response) {
      console.log("<-", response.status, response.statusText);
    },
  });

  const shelf = await client.getShelf();
  const notebooks = await getAllNotebooks(client);
  const selectedBooks = notebooks.slice(0, NOTEBOOK_LIMIT);
  const details = await mapWithConcurrency(selectedBooks, 3, async (item) => loadNotebookDetails(client, item));
  const timeline = buildTimeline(details).slice(0, TIMELINE_LIMIT);
  const html = renderHtml({
    shelfBooks: shelf.books ?? [],
    shelfAlbums: shelf.albums ?? [],
    notebookBooks: notebooks,
    notebookDetails: details,
    timeline,
    mp: shelf.mp ?? null,
  });

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, html, "utf8");

  console.log(
    JSON.stringify(
      {
        shelfBooks: (shelf.books ?? []).length,
        shelfAlbums: (shelf.albums ?? []).length,
        notebookBooks: notebooks.length,
        timelineItems: timeline.length,
        outputPath: OUTPUT_PATH,
      },
      null,
      2,
    ),
  );
}

async function getAllNotebooks(client: ReturnType<typeof createWereadClient>): Promise<NotebookBookSummary[]> {
  const books: NotebookBookSummary[] = [];
  let lastSort: number | undefined;

  while (true) {
    const page = await client.getNotebooks({
      count: 50,
      ...(lastSort ? { lastSort } : {}),
    });

    const pageBooks =
      page.books?.map((item) => ({
        bookId: item.bookId,
        title: item.book?.title ?? "未知书籍",
        author: item.book?.author ?? "",
        cover: item.book?.cover ?? "",
        reviewCount: item.reviewCount ?? 0,
        noteCount: item.noteCount ?? 0,
        bookmarkCount: item.bookmarkCount ?? 0,
        totalCount: (item.reviewCount ?? 0) + (item.noteCount ?? 0) + (item.bookmarkCount ?? 0),
        sort: item.sort ?? 0,
      })) ?? [];

    books.push(...pageBooks);

    if (page.hasMore !== 1 || pageBooks.length === 0) {
      break;
    }

    lastSort = pageBooks.at(-1)?.sort;
    if (!lastSort) {
      break;
    }
  }

  return books.sort((a, b) => b.totalCount - a.totalCount);
}

async function loadNotebookDetails(
  client: ReturnType<typeof createWereadClient>,
  item: NotebookBookSummary,
): Promise<NotebookDetailCard> {
  const [bookmarks, reviews] = await Promise.all([
    client.getBookmarkList({ bookId: item.bookId }),
    getAllMyReviews(client, item.bookId),
  ]);

  return {
    ...item,
    highlights: (bookmarks.updated ?? []).filter((entry) => Boolean(entry.markText)),
    reviews,
  };
}

async function getAllMyReviews(
  client: ReturnType<typeof createWereadClient>,
  bookId: string,
): Promise<PersonalReviewDetail[]> {
  const reviews: PersonalReviewDetail[] = [];
  let synckey = 0;

  while (true) {
    const page: ReviewListMineResponse = await client.getMyReviews({
      bookid: bookId,
      count: 50,
      synckey,
    });

    const pageReviews = (page.reviews ?? [])
      .map((item) => item.review)
      .filter((review): review is PersonalReviewDetail => Boolean(review));

    reviews.push(...pageReviews);

    if (page.hasMore !== 1 || !page.synckey) {
      break;
    }

    synckey = page.synckey;
  }

  return reviews;
}

function buildTimeline(details: NotebookDetailCard[]): TimelineItem[] {
  return details
    .flatMap((detail) => {
      const reviewItems = detail.reviews.map((review) => ({
        type: "review" as const,
        bookTitle: detail.title,
        cover: detail.cover,
        author: detail.author,
        content: review.content ?? "",
        abstract: review.abstract ?? "",
        createTime: review.createTime ?? 0,
      }));

      const highlightItems = detail.highlights.map((highlight) => ({
        type: "highlight" as const,
        bookTitle: detail.title,
        cover: detail.cover,
        author: detail.author,
        content: highlight.markText ?? "",
        abstract: "",
        createTime: highlight.createTime ?? 0,
      }));

      return [...reviewItems, ...highlightItems];
    })
    .filter((item) => item.createTime > 0 && item.content)
    .sort((a, b) => b.createTime - a.createTime);
}

function renderHtml(data: ArchiveData): string {
  const shelfTotal = data.shelfBooks.length + data.shelfAlbums.length + (data.mp ? 1 : 0);
  const topNotebookCards = data.notebookDetails.map(renderNotebookCard).join("");
  const timelineCards = data.timeline.map(renderTimelineCard).join("");
  const shelfCards = [...data.shelfBooks.map(renderShelfBookCard), ...data.shelfAlbums.map(renderShelfAlbumCard)]
    .slice(0, 24)
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>微信读书个人档案馆</title>
    <style>
      :root {
        --bg: #f5efe6;
        --paper: rgba(255, 251, 245, 0.96);
        --ink: #1d1916;
        --muted: #7a6c61;
        --line: #e7d8c4;
        --accent: #9f4e2c;
        --accent-soft: #e7c7a6;
        --shadow: 0 24px 60px rgba(76, 46, 24, .08);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--ink);
        font-family: "Iowan Old Style", "Palatino Linotype", serif;
        background:
          radial-gradient(circle at top left, rgba(159,78,44,.12), transparent 22%),
          linear-gradient(180deg, #f8f3eb 0%, #f1e9de 100%);
      }
      .page {
        max-width: 1400px;
        margin: 0 auto;
        padding: 30px 18px 56px;
      }
      .hero, .panel {
        background: var(--paper);
        border: 1px solid var(--line);
        box-shadow: var(--shadow);
      }
      .hero {
        padding: 28px;
        margin-bottom: 18px;
      }
      .eyebrow {
        margin: 0 0 10px;
        font-size: 12px;
        letter-spacing: .24em;
        text-transform: uppercase;
        color: var(--muted);
      }
      h1 {
        margin: 0;
        font-size: clamp(34px, 4vw, 62px);
        line-height: .95;
      }
      .lede {
        max-width: 760px;
        margin: 14px 0 0;
        font-size: 16px;
        line-height: 1.65;
        color: var(--muted);
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 12px;
        margin-top: 20px;
      }
      .metric {
        padding: 15px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,.46);
      }
      .metric-label {
        font-size: 12px;
        letter-spacing: .12em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .metric-value {
        margin-top: 8px;
        font-size: 28px;
        font-weight: 700;
      }
      .panel {
        padding: 22px;
        margin-bottom: 18px;
      }
      .section-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: baseline;
        margin-bottom: 14px;
      }
      .section-head h2 {
        margin: 0;
        font-size: 24px;
      }
      .section-head p {
        margin: 0;
        color: var(--muted);
        font-size: 14px;
      }
      .shelf-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 14px;
      }
      .shelf-card {
        border: 1px solid var(--line);
        background: rgba(255,255,255,.5);
        padding: 12px;
      }
      .cover {
        width: 100%;
        aspect-ratio: 0.72;
        object-fit: cover;
        border-radius: 10px;
        background: #eadfcf;
        box-shadow: 0 12px 26px rgba(83, 54, 29, .12);
      }
      .shelf-title, .notebook-title {
        margin: 12px 0 6px;
        font-size: 16px;
      }
      .meta {
        margin: 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
      }
      .notebook-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 16px;
      }
      .notebook-card {
        border: 1px solid var(--line);
        background: rgba(255,255,255,.5);
        padding: 14px;
      }
      .notebook-head {
        display: grid;
        grid-template-columns: 76px 1fr;
        gap: 14px;
      }
      .mini-cover {
        width: 76px;
        aspect-ratio: 0.72;
        object-fit: cover;
        border-radius: 10px;
        background: #eadfcf;
      }
      .counts {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      .count-chip {
        border: 1px solid var(--line);
        background: #fff8ef;
        padding: 6px 8px;
        font-size: 12px;
        color: var(--muted);
      }
      .excerpt-list {
        display: grid;
        gap: 10px;
        margin-top: 14px;
      }
      .excerpt {
        border-left: 3px solid var(--accent-soft);
        padding-left: 10px;
      }
      .excerpt p {
        margin: 0;
        font-size: 14px;
        line-height: 1.55;
      }
      .excerpt small {
        display: block;
        margin-top: 4px;
        color: var(--muted);
      }
      .timeline {
        display: grid;
        gap: 12px;
      }
      .timeline-card {
        display: grid;
        grid-template-columns: 56px 1fr;
        gap: 12px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,.5);
        padding: 12px;
      }
      .timeline-cover {
        width: 56px;
        aspect-ratio: 0.72;
        object-fit: cover;
        border-radius: 8px;
        background: #eadfcf;
      }
      .timeline-type {
        font-size: 12px;
        letter-spacing: .12em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .timeline-book {
        margin: 2px 0 6px;
        font-size: 16px;
      }
      .timeline-content {
        margin: 0;
        font-size: 14px;
        line-height: 1.6;
      }
      .timeline-time {
        margin-top: 6px;
        font-size: 12px;
        color: var(--muted);
      }
      @media (max-width: 720px) {
        .notebook-head {
          grid-template-columns: 64px 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <p class="eyebrow">WeRead Personal Archive</p>
        <h1>个人读书档案馆</h1>
        <p class="lede">
          这份页面把你的书架、笔记本、划线与个人评论导出成一个可浏览的个人阅读档案。
          重点呈现书架全貌、笔记最密集的书、以及最近留下的想法与划线痕迹。
        </p>
        <div class="summary">
          <div class="metric"><div class="metric-label">书架条目</div><div class="metric-value">${shelfTotal}</div></div>
          <div class="metric"><div class="metric-label">电子书</div><div class="metric-value">${data.shelfBooks.length}</div></div>
          <div class="metric"><div class="metric-label">专辑/有声书</div><div class="metric-value">${data.shelfAlbums.length}</div></div>
          <div class="metric"><div class="metric-label">有笔记的书</div><div class="metric-value">${data.notebookBooks.length}</div></div>
          <div class="metric"><div class="metric-label">时间线条目</div><div class="metric-value">${data.timeline.length}</div></div>
        </div>
      </section>

      <section class="panel">
        <div class="section-head">
          <h2>书架精选</h2>
          <p>展示前 24 个书架条目，包含电子书与有声书。</p>
        </div>
        <div class="shelf-grid">${shelfCards}</div>
      </section>

      <section class="panel">
        <div class="section-head">
          <h2>笔记最密集的书</h2>
          <p>按总笔记数排序，包含书签数、划线数、想法/点评数。</p>
        </div>
        <div class="notebook-grid">${topNotebookCards}</div>
      </section>

      <section class="panel">
        <div class="section-head">
          <h2>最近的划线与想法</h2>
          <p>按时间倒序混合展示个人评论与划线原文。</p>
        </div>
        <div class="timeline">${timelineCards}</div>
      </section>
    </main>
  </body>
</html>`;
}

function renderShelfBookCard(book: ShelfBookItem): string {
  const cover = book.cover
    ? `<img class="cover" src="${escapeHtml(book.cover)}" alt="${escapeHtml(book.title ?? "书籍封面")}" loading="lazy" />`
    : `<div class="cover"></div>`;

  return `
    <article class="shelf-card">
      ${cover}
      <h3 class="shelf-title">${escapeHtml(book.title ?? "未知书籍")}</h3>
      <p class="meta">${escapeHtml(book.author ?? "")}</p>
      <p class="meta">${escapeHtml(book.category ?? "")}</p>
    </article>
  `;
}

function renderShelfAlbumCard(album: ShelfAlbumItem): string {
  const info = album.albumInfo;
  const cover = info.cover
    ? `<img class="cover" src="${escapeHtml(info.cover)}" alt="${escapeHtml(info.name ?? "专辑封面")}" loading="lazy" />`
    : `<div class="cover"></div>`;

  return `
    <article class="shelf-card">
      ${cover}
      <h3 class="shelf-title">${escapeHtml(info.name ?? "未知专辑")}</h3>
      <p class="meta">${escapeHtml(info.authorName ?? "")}</p>
      <p class="meta">${info.trackCount ?? 0} 集</p>
    </article>
  `;
}

function renderNotebookCard(item: NotebookDetailCard): string {
  const cover = item.cover
    ? `<img class="mini-cover" src="${escapeHtml(item.cover)}" alt="${escapeHtml(item.title)}" loading="lazy" />`
    : `<div class="mini-cover"></div>`;

  const highlightExcerpts = item.highlights.slice(0, 2).map(renderHighlightExcerpt).join("");
  const reviewExcerpts = item.reviews.slice(0, 2).map(renderReviewExcerpt).join("");

  return `
    <article class="notebook-card">
      <div class="notebook-head">
        ${cover}
        <div>
          <h3 class="notebook-title">${escapeHtml(item.title)}</h3>
          <p class="meta">${escapeHtml(item.author)}</p>
          <div class="counts">
            <span class="count-chip">总笔记 ${item.totalCount}</span>
            <span class="count-chip">划线 ${item.noteCount}</span>
            <span class="count-chip">想法 ${item.reviewCount}</span>
            <span class="count-chip">书签 ${item.bookmarkCount}</span>
          </div>
        </div>
      </div>
      <div class="excerpt-list">
        ${highlightExcerpts}
        ${reviewExcerpts}
      </div>
    </article>
  `;
}

function renderHighlightExcerpt(item: BookmarkListItem): string {
  return `
    <div class="excerpt">
      <p>${escapeHtml(item.markText ?? "")}</p>
      <small>划线 · ${formatDate(item.createTime ?? 0)}</small>
    </div>
  `;
}

function renderReviewExcerpt(item: PersonalReviewDetail): string {
  const label = item.chapterName ? `想法 · ${item.chapterName}` : "书评 / 点评";
  return `
    <div class="excerpt">
      <p>${escapeHtml(item.content ?? "")}</p>
      <small>${escapeHtml(label)} · ${formatDate(item.createTime ?? 0)}</small>
    </div>
  `;
}

function renderTimelineCard(item: TimelineItem): string {
  const cover = item.cover
    ? `<img class="timeline-cover" src="${escapeHtml(item.cover)}" alt="${escapeHtml(item.bookTitle)}" loading="lazy" />`
    : `<div class="timeline-cover"></div>`;

  return `
    <article class="timeline-card">
      ${cover}
      <div>
        <div class="timeline-type">${item.type === "review" ? "Review" : "Highlight"}</div>
        <h3 class="timeline-book">${escapeHtml(item.bookTitle)}</h3>
        <p class="timeline-content">${escapeHtml(item.content)}</p>
        <div class="timeline-time">${formatDate(item.createTime)}</div>
      </div>
    </article>
  `;
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  limit: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results: TOutput[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      const item = items[current];
      if (item === undefined) {
        continue;
      }
      results[current] = await mapper(item, current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function formatDate(timestamp: number): string {
  if (!timestamp) {
    return "未知时间";
  }

  const date = new Date(timestamp * 1000);
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

interface NotebookBookSummary {
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

interface NotebookDetailCard extends NotebookBookSummary {
  highlights: BookmarkListItem[];
  reviews: PersonalReviewDetail[];
}

interface TimelineItem {
  type: "review" | "highlight";
  bookTitle: string;
  cover: string;
  author: string;
  content: string;
  abstract: string;
  createTime: number;
}

interface ArchiveData {
  shelfBooks: ShelfBookItem[];
  shelfAlbums: ShelfAlbumItem[];
  notebookBooks: NotebookBookSummary[];
  notebookDetails: NotebookDetailCard[];
  timeline: TimelineItem[];
  mp: Record<string, unknown> | null;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
