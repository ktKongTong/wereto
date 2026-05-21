import { useEffect, useState } from "react";

import type { HistoryYearRecord } from "../../api/read-models/history.read-model";
import { Skeleton } from "../../components/ui/skeleton";
import { formatDate, formatDuration } from "../../lib/format";
import { useHistoryQuery, useSessionQuery } from "../../lib/queries";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CURRENT_YEAR = new Date().getFullYear();
const LOADING_YEARS = Array.from({ length: 9 }, (_, index) => CURRENT_YEAR - index);

export default function HistoryPage() {
  return <HistoryScreen />;
}

function HistoryScreen() {
  const session = useSessionQuery();
  const canView = Boolean(session.data?.authenticated || session.data?.public);
  const [activeYear, setActiveYear] = useState<number | null>(null);

  const { data, error, isPending } = useHistoryQuery(canView);

  useEffect(() => {
    if (data && activeYear === null) {
      setActiveYear(data.records.at(0)?.year ?? null);
    }
  }, [activeYear, data]);

  if (error) {
    return (
      <HistoryEmptyState
        title="数据不可用"
        description="历史数据加载失败"
        detail={error instanceof Error ? error.message : "未知错误"}
      />
    );
  }

  if (!session.isPending && !canView) {
    return <HistoryEmptyState title="阅读数据未公开" description="登录后可查看" />;
  }

  if (session.isPending || isPending || !data) {
    return <HistorySkeleton />;
  }

  if (data.records.length === 0 || activeYear === null) {
    return <HistoryEmptyState title="还没有历史数据" description="完成一次同步后，这里会显示年度阅读热力图和阅读记录。" />;
  }

  const activeRecord = data.records
    .find((record) => record.year === activeYear) ?? data.records.at(-1)!;
  const splitHeatmapSegments = splitHeatmapCells(activeRecord.cells);

  const topRead = (activeRecord.annual.readLongest ?? []).slice(0, 10).map((item) => ({
    cover: item.book?.cover ?? item.albumInfo?.cover ?? "",
    primary: item.book?.title ?? item.albumInfo?.name ?? "未知条目",
    secondary: item.book?.author ?? item.albumInfo?.authorName ?? "",
    meta: formatDuration(item.readTime ?? 0),
  }));
  const highlight = activeRecord.annotations.recentHighlights;
  const review = activeRecord.annotations.recentReviews;


  return (
    <section className="mx-auto grid w-full max-w-4xl gap-10 max-md:gap-8">
        <section className="grid min-w-0 gap-8 xl:grid-cols-[240px_minmax(0,1fr)] xl:items-start">
          <ActivityStats record={activeRecord} />

          <div className="min-w-0 overflow-hidden md:overflow-visible">
            <div className="mb-4 text-3xl font-semibold text-foreground md:text-4xl">Activity</div>
            <div className="flex w-full min-w-0 flex-col gap-5 overflow-hidden md:flex-row md:items-start md:overflow-visible">
              <div data-year-list className="flex w-full min-w-0 max-w-full gap-4 overflow-x-auto overflow-y-hidden px-0.5 md:w-auto md:flex-col md:overflow-visible md:scrollbar-none max-md:w-[calc(100vw-40px)] max-md:max-w-[calc(100vw-40px)] max-md:[&::-webkit-scrollbar]:hidden">
                {data.records.map((record) => (
                  <button
                    key={record.year}
                    type="button"
                    onClick={() => setActiveYear(record.year)}
                    className={[
                      "grid min-h-7 flex-none justify-items-start text-left text-muted-foreground transition duration-150 hover:text-foreground/80",
                      record.year === activeYear ? "translate-x-0.5 text-foreground max-md:translate-x-0" : "",
                    ].join(" ")}
                    aria-current={record.year === activeYear ? "true" : undefined}
                  >
                    <span
                      className={[
                        "leading-none text-xl",
                        record.year === activeYear ? "text-[24px] text-foreground" : "",
                      ].join(" ")}
                    >
                      {record.year}
                    </span>
                  </button>
                ))}
              </div>
              <Heatmap maxValue={activeRecord.maxValue} splitSegments={splitHeatmapSegments} />
            </div>
          </div>
        </section>

        <section className="grid gap-8 lg:grid-cols-3 lg:items-start">
          <RankList
            title="Top Read"
            items={topRead}
          />
          <AnnotationList title="Highlight" items={highlight} emptyText={`No highlights in ${activeRecord.year}`} />
          <AnnotationList title="Review" items={review} emptyText={`No reviews in ${activeRecord.year}`} />
        </section>
    </section>
  );
}

function HistorySkeleton() {
  const emptyHeatmapSegments = splitHeatmapCells(createEmptyHeatmapCells(CURRENT_YEAR));

  return (
    <section className="mx-auto grid w-full max-w-4xl gap-10 max-md:gap-8">
      <section className="grid min-w-0 gap-8 xl:grid-cols-[240px_minmax(0,1fr)] xl:items-start">
        <ActivityStatsSkeleton />
        <div className="min-w-0 overflow-hidden md:overflow-visible">
          <div className="mb-4 text-3xl font-semibold text-foreground md:text-4xl">Activity</div>
          <div className="flex w-full min-w-0 flex-col gap-5 overflow-hidden md:flex-row md:items-start md:overflow-visible">
            <div data-year-list className="flex w-full min-w-0 max-w-full gap-4 overflow-x-auto overflow-y-hidden px-0.5 md:w-auto md:flex-col md:overflow-visible md:scrollbar-none max-md:w-[calc(100vw-40px)] max-md:max-w-[calc(100vw-40px)] max-md:[&::-webkit-scrollbar]:hidden">
              {LOADING_YEARS.map((year) => (
                <div
                  key={year}
                  className={[
                    "grid min-h-7 flex-none justify-items-start text-left text-muted-foreground",
                    year === CURRENT_YEAR ? "translate-x-0.5 text-foreground max-md:translate-x-0" : "",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "leading-none text-xl",
                      year === CURRENT_YEAR ? "text-[24px] text-foreground" : "",
                    ].join(" ")}
                  >
                    {year}
                  </span>
                </div>
              ))}
            </div>
            <Heatmap maxValue={1} splitSegments={emptyHeatmapSegments} />
          </div>
        </div>
      </section>
      <section className="grid gap-8 lg:grid-cols-3 lg:items-start">
        <HistoryListSkeleton title="Top Read" />
        <HistoryListSkeleton title="Highlight" />
        <HistoryListSkeleton title="Review" />
      </section>
    </section>
  );
}

function ActivityStatsSkeleton() {
  const metrics = ["Read Time", "Notebook Books", "Highlight", "Review"];

  return (
    <aside className="grid grid-cols-2 gap-x-6 gap-y-6 xl:grid-cols-1">
      {metrics.map((label, index) => (
        <div key={label}>
          <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground/75">{label}</div>
          <Skeleton className={index === 0 ? "mt-2 h-9 w-36" : "mt-2 h-9 w-12"} />
        </div>
      ))}
    </aside>
  );
}

function HistoryListSkeleton({ title }: { title: string }) {
  return (
    <section>
      <h2 className="mb-4 text-2xl font-semibold text-foreground">{title}</h2>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="grid grid-cols-[44px_1fr] gap-3">
            <Skeleton className="size-11 rounded-md" />
            <div className="min-w-0">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="mt-2 h-3 w-2/3" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HistoryEmptyState({ title, description, detail }: { title: string; description: string; detail?: string }) {
  return (
    <section className="mx-auto flex min-h-[50vh] w-full max-w-4xl items-center">
      <div className="max-w-xl">
        <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground/75">History</div>
        <h2 className="mt-3 text-4xl font-semibold text-foreground">{title}</h2>
        <p className="mt-4 text-base leading-7 text-muted-foreground">{description}</p>
        {detail ? <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground/80">{detail}</p> : null}
      </div>
    </section>
  );
}

type HistoryCell = {
  key: string;
  label: string;
  seconds: number;
  month: number;
  weekIndex: number;
  inYear: boolean;
};

type HeatmapSegment = {
  id: string;
  cells: HistoryCell[];
  firstWeek: number;
  weekCount: number;
  monthMarkers: Array<{ month: number; column: number }>;
};

function createEmptyHeatmapCells(year: number): HistoryCell[] {
  const start = new Date(Date.UTC(year, 0, 1));
  const mondayOffset = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - mondayOffset);

  return Array.from({ length: 53 * 7 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const weekIndex = Math.floor(index / 7);
    const label = date.toISOString().slice(0, 10);

    return {
      key: `loading-${label}`,
      label,
      seconds: 0,
      month: date.getUTCMonth(),
      weekIndex,
      inYear: date.getUTCFullYear() === year,
    };
  });
}

function splitHeatmapCells(cells: HistoryCell[]): HeatmapSegment[] {
  const segments = [
    createHeatmapSegment("first", cells, 0, 26),
    createHeatmapSegment("second", cells, 26, 53),
  ];
  return segments.filter((segment) => segment.cells.length > 0);
}

function createHeatmapSegment(id: string, cells: HistoryCell[], startWeek: number, endWeek: number): HeatmapSegment {
  const segmentCells = cells.filter((cell) => cell.weekIndex >= startWeek && cell.weekIndex < endWeek);
  const seen = new Set<number>();
  const monthMarkers = segmentCells.flatMap((cell) => {
    if (!cell.inYear) return [];
    const date = new Date(`${cell.label}T00:00:00Z`);
    if (date.getUTCDate() <= 7 && !seen.has(cell.month)) {
      seen.add(cell.month);
      return [{ month: cell.month, column: cell.weekIndex - startWeek + 2 }];
    }
    return [];
  });

  return {
    id,
    cells: segmentCells,
    firstWeek: startWeek,
    weekCount: endWeek - startWeek,
    monthMarkers,
  };
}

function Heatmap({
  maxValue,
  splitSegments,
}: {
  maxValue: number;
  splitSegments: HeatmapSegment[];
}) {
  return (
    <div className="flex flex-col items-center w-fit gap-9 [--history-cell:12px] [--history-gap:3px] max-md:-mx-3 max-md:w-[calc(100%+24px)] max-md:[--history-cell:10px] max-md:[--history-gap:3px]">
      {splitSegments.map((segment) => (
        <HeatmapSegmentView key={segment.id} maxValue={maxValue} segment={segment} />
      ))}
    </div>
  );
}

function HeatmapSegmentView({
  className = "",
  maxValue,
  segment,
}: {
  className?: string;
  maxValue: number;
  segment: HeatmapSegment;
}) {
  return (
    <div
      className={`w-fit max-w-full [--history-weeks:27] ${className}`}
      style={{ "--history-weeks": segment.weekCount } as React.CSSProperties}
    >
      <div className="mb-2 grid grid-cols-[32px_repeat(var(--history-weeks),var(--history-cell))] gap-[var(--history-gap)] max-sm:grid-cols-[20px_repeat(var(--history-weeks),var(--history-cell))]">
        <div />
        {segment.monthMarkers.map((item) => (
          <div key={`${segment.id}-${item.month}-${item.column}`} className="text-[11px] text-muted-foreground/75" style={{ gridColumn: item.column }}>
            {MONTH_LABELS[item.month]}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[30px_auto] gap-2 max-sm:grid-cols-[18px_auto]">
        <div className="grid grid-rows-7 gap-1 pt-px text-[10px] text-muted-foreground/55">
          <span>Mon</span>
          <span className="invisible">.</span>
          <span>Wed</span>
          <span className="invisible">.</span>
          <span>Fri</span>
          <span className="invisible">.</span>
          <span className="invisible">.</span>
        </div>
        <div className="grid grid-flow-col grid-rows-7 grid-cols-[repeat(var(--history-weeks),var(--history-cell))] gap-[var(--history-gap)]">
          {segment.cells.map((cell) => {
            const level = !cell.inYear || cell.seconds === 0 ? 0 : Math.max(1, Math.ceil((cell.seconds / maxValue) * 4));
            return (
              <div
                key={cell.key}
                className="size-[var(--history-cell)] rounded-[3px] transition hover:scale-110"
                style={{
                  opacity: cell.inYear ? 1 : 0.18,
                  backgroundColor: `var(--level-${level})`,
                }}
                title={`${cell.label} · ${formatDuration(cell.seconds)}`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ActivityStats({ record }: { record: HistoryYearRecord }) {
  return (
    <aside className="grid grid-cols-2 gap-x-6 gap-y-6 xl:grid-cols-1">
      <Metric label="Read Time" value={formatDuration(record.annual.totalReadTime)} />
      <Metric label="Notebook Books" value={String(record.annotations.notebookBooks)} />
      <Metric label="Highlight" value={String(record.annotations.highlights)} />
      <Metric label="Review" value={String(record.annotations.reviews)} />
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground/75">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

function AnnotationList({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: Array<{ bookTitle: string; cover: string | null; content: string; createTime: number }>;
  emptyText: string;
}) {
  return (
    <section>
      <h2 className="mb-4 text-2xl font-semibold text-foreground">{title}</h2>
      {items.length > 0 ? (
        <div className="space-y-3">
          {items.slice(0, 10).map((item, index) => (
            <div key={`${title}-${item.bookTitle}-${item.createTime}-${index}`} className="grid grid-cols-[44px_1fr] gap-3">
              {item.cover ? <img src={item.cover} alt="" className="size-11 rounded-md object-cover" /> : <div className="size-11 rounded-md bg-muted" />}
              <div className="min-w-0">
                <div className="flex items-baseline gap-2 text-xs text-muted-foreground/75">
                  <span>{formatDate(item.createTime)}</span>
                </div>
                <div className="truncate text-sm text-foreground/80">{item.bookTitle}</div>
                <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">{item.content}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground/75">{emptyText}</div>
      )}
    </section>
  );
}

function RankList({
  title,
  items,
}: {
  title: string;
  items: Array<{ cover: string; primary: string; secondary: string; meta: string }>;
}) {
  return (
    <section>
      <h2 className="mb-4 text-2xl font-semibold text-foreground">{title}</h2>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={`${item.primary}-${item.meta}`} className="grid grid-cols-[44px_1fr] gap-3">
            {item.cover ? <img src={item.cover} alt="" className="size-11 rounded-md object-cover" /> : <div className="size-11 rounded-md bg-muted" />}
            <div>
              <div className="text-sm text-foreground">{item.primary}</div>
              <div className="text-xs text-muted-foreground">{item.secondary}</div>
              <div className="text-xs text-muted-foreground/75">{item.meta}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
