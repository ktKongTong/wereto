export const ONE_DAY_SECONDS = 86400;
export const D1_MAX_STATEMENT_PARAMS = 100;

export function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

export function toJson(value: unknown) {
  return JSON.stringify(value);
}

export function parseJson<T>(value: string) {
  return JSON.parse(value) as T;
}

export function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function paramLimitedChunks<T>(items: T[], paramsPerRow: number) {
  return chunkArray(items, Math.max(1, Math.floor(D1_MAX_STATEMENT_PARAMS / paramsPerRow)));
}

export function rowParamLimitedChunks<T extends Record<string, unknown>>(items: T[]) {
  const paramsPerRow = items[0] ? Object.keys(items[0]).length : 1;
  return paramLimitedChunks(items, paramsPerRow);
}

export function estimateReadingPeriodCount(registTime: number | undefined, now: number) {
  const start = registTime ?? Math.floor(Date.UTC(new Date().getFullYear(), 0, 1) / 1000);
  const weeks = Math.ceil((now - start) / (7 * ONE_DAY_SECONDS));
  return weeks + 1;
}

export function getPeriodStartKey(periodType: string, baseTime: number) {
  if (periodType === "overall") return "overall";
  if (periodType === "annually") return String(getShanghaiDateParts(baseTime).year);
  if (periodType === "monthly") {
    const parts = getShanghaiDateParts(baseTime);
    return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
  }
  return formatShanghaiDate(baseTime);
}

export function getPeriodEndKey(periodType: string, baseTime: number) {
  if (periodType === "overall") return null;

  const start = new Date(baseTime * 1000);
  if (periodType === "weekly") {
    start.setUTCDate(start.getUTCDate() + 6);
    return formatShanghaiDate(Math.floor(start.getTime() / 1000));
  }
  if (periodType === "monthly") {
    const parts = getShanghaiDateParts(baseTime);
    return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
  }
  return String(getShanghaiDateParts(baseTime).year);
}

export function formatShanghaiDate(timestamp: number) {
  const parts = getShanghaiDateParts(timestamp);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function getShanghaiDateParts(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp * 1000));

  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
}
