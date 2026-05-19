import { useEffect, useMemo, useState } from "react";

import type { ArchiveReadBook, ArchiveTimelineItem, ShelfAlbumItem, ShelfBookItem } from "../../api/weread";
import { formatDate, formatDuration } from "../../lib/format";
import { useArchiveQuery, useSessionQuery } from "../../lib/queries";
import { useShell } from "./layout";

const PAGE_SIZE = 24;

type ArchiveTab = "shelf" | "read" | "highlights" | "reviews";

type ShelfEntry = {
  id: string;
  title: string;
  author: string;
  cover: string;
  meta: string;
};

export default function ArchivePage() {
  return <ArchiveScreen />;
}

function ArchiveScreen() {
  const session = useSessionQuery();
  const canView = Boolean(session.data?.authenticated || session.data?.public);
  const { data, error, isPending } = useArchiveQuery(canView);
  const { openSettings } = useShell();
  const [activeTab, setActiveTab] = useState<ArchiveTab>("shelf");
  const [pageByTab, setPageByTab] = useState<Record<ArchiveTab, number>>({
    shelf: 1,
    read: 1,
    highlights: 1,
    reviews: 1,
  });

  useEffect(() => {
    if (!session.isPending && !canView) {
      openSettings("account");
    }
  }, [canView, openSettings, session.isPending]);

  if (error) {
    return <main className="mx-auto max-w-5xl px-6 py-20 text-red-600">{error instanceof Error ? error.message : "加载失败"}</main>;
  }

  if (!session.isPending && !canView) {
    return (
      <section className="max-w-xl space-y-4 pt-10">
        <h2 className="text-3xl font-semibold text-foreground">Private, please login first</h2>
      </section>
    );
  }

  if (session.isPending || isPending || !data) {
    return <main className="mx-auto max-w-5xl px-6 py-20 text-foreground/60">Loading archive...</main>;
  }

  const shelfEntries = toShelfEntries([...data.shelfBooks, ...data.shelfAlbums]);
  const highlights = data.timeline.filter((item) => item.type === "highlight");
  const reviews = data.timeline.filter((item) => item.type === "review");
  const tabItems = {
    shelf: shelfEntries,
    read: data.readBooks,
    highlights,
    reviews,
  };
  const activeItems = tabItems[activeTab];
  const currentPage = pageByTab[activeTab];
  const pageCount = Math.max(1, Math.ceil(activeItems.length / PAGE_SIZE));
  const pageItems = activeItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const setPage = (page: number) => setPageByTab((current) => ({ ...current, [activeTab]: Math.min(Math.max(page, 1), pageCount) }));
  const setTab = (tab: ArchiveTab) => {
    setActiveTab(tab);
    setPageByTab((current) => ({ ...current, [tab]: current[tab] ?? 1 }));
  };

  return (
    <section className="mx-auto grid w-full max-w-4xl gap-10">
        <ArchiveSummary
          shelfCount={shelfEntries.length}
          readCount={data.readBooks.length}
          highlightCount={highlights.length}
          reviewCount={reviews.length}
        />

        <section className="space-y-6">
          <ArchiveTabs
            activeTab={activeTab}
            onTabChange={setTab}
            counts={{
              shelf: shelfEntries.length,
              read: data.readBooks.length,
              highlights: highlights.length,
              reviews: reviews.length,
            }}
          />

          <div>
            {activeTab === "shelf" ? <ShelfGrid items={pageItems as ShelfEntry[]} /> : null}
            {activeTab === "read" ? <ReadBookGrid items={pageItems as ArchiveReadBook[]} /> : null}
            {activeTab === "highlights" ? <TimelineGrid items={pageItems as ArchiveTimelineItem[]} /> : null}
            {activeTab === "reviews" ? <TimelineGrid items={pageItems as ArchiveTimelineItem[]} /> : null}
          </div>

          <Pagination
            page={currentPage}
            pageCount={pageCount}
            total={activeItems.length}
            onPrev={() => setPage(currentPage - 1)}
            onNext={() => setPage(currentPage + 1)}
          />
        </section>
    </section>
  );
}

function ArchiveSummary({
  shelfCount,
  readCount,
  highlightCount,
  reviewCount,
}: {
  shelfCount: number;
  readCount: number;
  highlightCount: number;
  reviewCount: number;
}) {
  return (
    <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="书架" value={String(shelfCount)} />
      <Metric label="读过" value={String(readCount)} />
      <Metric label="划线" value={String(highlightCount)} />
      <Metric label="想法" value={String(reviewCount)} />
    </section>
  );
}

function ArchiveTabs({
  activeTab,
  counts,
  onTabChange,
}: {
  activeTab: ArchiveTab;
  counts: Record<ArchiveTab, number>;
  onTabChange: (tab: ArchiveTab) => void;
}) {
  const tabs: Array<{ key: ArchiveTab; label: string }> = [
    { key: "shelf", label: "书架" },
    { key: "read", label: "读过" },
    { key: "highlights", label: "划线" },
    { key: "reviews", label: "想法" },
  ];

  return (
    <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
      {tabs.map((tab) => {
        const active = tab.key === activeTab;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            className={`text-left transition ${active ? "text-3xl font-semibold text-foreground" : "text-2xl text-muted-foreground hover:text-foreground/75"}`}
          >
            {tab.label}
            <span className="ml-2 align-baseline text-sm text-muted-foreground/75">{counts[tab.key]}</span>
          </button>
        );
      })}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground/75">{label}</div>
      <div className="mt-2 text-4xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

function ShelfGrid({ items }: { items: ShelfEntry[] }) {
  return (
    <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <BookRow
          key={item.id}
          title={item.title}
          author={item.author}
          cover={item.cover}
          meta={item.meta}
        />
      ))}
    </div>
  );
}

function ReadBookGrid({ items }: { items: ArchiveReadBook[] }) {
  return (
    <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <BookRow
          key={item.bookId}
          title={item.title}
          author={item.author}
          cover={item.cover}
          meta={`${formatDuration(item.totalReadTime)} · ${item.seenPeriods} 周 · 最近 ${item.lastSeenPeriodStart}`}
        />
      ))}
    </div>
  );
}

function TimelineGrid({ items }: { items: ArchiveTimelineItem[] }) {
  return (
    <div className="grid gap-x-10 gap-y-5 lg:grid-cols-2">
      {items.map((item, index) => (
        <BookRow
          key={`${item.type}-${item.bookTitle}-${item.createTime}-${index}`}
          title={item.bookTitle}
          cover={item.cover}
          meta={formatDate(item.createTime)}
          content={item.content}
        />
      ))}
    </div>
  );
}

function BookRow({
  title,
  author,
  cover,
  meta,
  content,
}: {
  title: string;
  author?: string;
  cover: string;
  meta: string;
  content?: string;
}) {
  return (
    <article className="grid min-w-0 grid-cols-[48px_1fr] gap-3">
      {cover ? <img src={cover} alt="" className="size-12 rounded-md object-cover" /> : <div className="size-12 rounded-md bg-muted" />}
      <div className="min-w-0">
        <h3 className="line-clamp-2 text-base font-semibold leading-5 text-foreground">{title}</h3>
        {author ? <div className="truncate text-sm text-muted-foreground">{author}</div> : null}
        {content ? <div className="line-clamp-3 text-sm leading-6 text-muted-foreground">{content}</div> : null}
        <div className="mt-0.5 text-xs leading-5 text-muted-foreground/75">{meta}</div>
      </div>
    </article>
  );
}

function Pagination({
  page,
  pageCount,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="flex items-center justify-between border-t border-border pt-5 text-sm text-muted-foreground">
      <div>
        {start}-{end} / {total}
      </div>
      <div className="flex items-center gap-4">
        <button type="button" onClick={onPrev} disabled={page <= 1} className="text-foreground/60 transition hover:text-foreground disabled:text-muted-foreground/35">
          上一页
        </button>
        <span>
          {page} / {pageCount}
        </span>
        <button type="button" onClick={onNext} disabled={page >= pageCount} className="text-foreground/60 transition hover:text-foreground disabled:text-muted-foreground/35">
          下一页
        </button>
      </div>
    </div>
  );
}

function toShelfEntries(items: Array<ShelfBookItem | ShelfAlbumItem>): ShelfEntry[] {
  return items.map((item, index) => {
    const isAlbum = "albumInfo" in item;
    if (isAlbum) {
      return {
        id: `album-${item.albumInfo.albumId ?? index}`,
        title: item.albumInfo.name ?? "未知专辑",
        author: item.albumInfo.authorName ?? "",
        cover: item.albumInfo.cover ?? "",
        meta: `${item.albumInfo.trackCount ?? 0} 集`,
      };
    }

    return {
      id: `book-${item.bookId ?? index}`,
      title: item.title ?? "未知书籍",
      author: item.author ?? "",
      cover: item.cover ?? "",
      meta: item.category ?? "",
    };
  });
}
