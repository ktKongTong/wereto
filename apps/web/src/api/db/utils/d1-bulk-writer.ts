import { inArray } from "drizzle-orm";

import { excludedSet } from "./drizzle-helpers.ts";

export const D1_MAX_STATEMENT_PARAMS = 100;

export function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function rowParamLimitedChunks<T extends Record<string, unknown>>(items: T[]) {
  const paramsPerRow = items.reduce((max, item) => Math.max(max, Object.keys(item).length), 1);
  return chunkArray(items, Math.max(1, Math.floor(D1_MAX_STATEMENT_PARAMS / paramsPerRow)));
}

export async function bulkInsert<T extends Record<string, unknown>>(db: unknown, table: unknown, values: T[]) {
  for (const chunk of rowParamLimitedChunks(values)) {
    await (db as any).insert(table).values(chunk);
  }
}

export async function bulkUpsert<T extends Record<string, unknown>>(
  db: unknown,
  table: unknown,
  target: unknown | unknown[],
  values: T[],
  updateColumns: string[],
) {
  if (values.length === 0) return;
  for (const chunk of rowParamLimitedChunks(values)) {
    await (db as any).insert(table).values(chunk).onConflictDoUpdate({
      target,
      set: excludedSet(updateColumns),
    });
  }
}

export async function upsertOne<T extends Record<string, unknown>>(
  db: unknown,
  table: unknown,
  target: unknown | unknown[],
  value: T,
  updateColumns: string[],
) {
  await bulkUpsert(db, table, target, [value], updateColumns);
}

export async function deleteWhereIn(db: unknown, table: unknown, column: unknown, values: unknown[]) {
  for (const chunk of chunkArray(values, D1_MAX_STATEMENT_PARAMS)) {
    await (db as any).delete(table).where(inArray(column as any, chunk as any));
  }
}
