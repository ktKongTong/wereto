import { sql } from "drizzle-orm";

export function excludedSet(columns: string[]) {
  return Object.fromEntries(columns.map((column) => [toCamel(column), sql.raw(`excluded.${column}`)]));
}

export function pick(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, source[key] ?? null]));
}

export function toCamel(column: string) {
  return column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
