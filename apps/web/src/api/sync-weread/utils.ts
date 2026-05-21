export const ONE_DAY_SECONDS = 86400;

export { nowUnix } from "../time.ts";

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
