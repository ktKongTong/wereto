import { inArray } from "drizzle-orm";
import type { AnySQLiteColumn, AnySQLiteTable, SQLiteInsertValue } from "drizzle-orm/sqlite-core";

import type { DB } from "../client.ts";
import { type ConflictUpdateColumns, excludedUpdateSet } from "./drizzle-helpers.ts";

export const D1_MAX_STATEMENT_PARAMS = 100;
export const D1_MAX_BATCH_STATEMENTS = 50;

export function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

type InsertRow<TTable extends AnySQLiteTable> = SQLiteInsertValue<TTable>;
type ConflictTarget = AnySQLiteColumn | AnySQLiteColumn[];
export type BatchStatement = Parameters<DB["batch"]>[0][number];
type BulkUpsertOptions = {
  exclude?: string[];
};

export function rowParamLimitedChunks<T extends object>(items: T[]) {
  const paramsPerRow = items.reduce((max, item) => Math.max(max, Object.keys(item).length), 1);
  return chunkArray(items, Math.max(1, Math.floor(D1_MAX_STATEMENT_PARAMS / paramsPerRow)));
}

export async function bulkInsert<TTable extends AnySQLiteTable>(db: DB, table: TTable, values: Array<InsertRow<TTable>>) {
  if (values.length === 0) return;
  await executeStatementBatches(db, bulkInsertStatements(db, table, values));
}

export function bulkInsertStatements<TTable extends AnySQLiteTable>(db: DB, table: TTable, values: Array<InsertRow<TTable>>) {
  return rowParamLimitedChunks(values).map((chunk) => db.insert(table).values(chunk));
}

export async function bulkUpsert<TTable extends AnySQLiteTable>(
  db: DB,
  table: TTable,
  target: ConflictTarget,
  values: Array<InsertRow<TTable>>,
  options: BulkUpsertOptions = {},
) {
  if (values.length === 0) return;
  const updateColumns = inferUpdateColumns(table, target, values[0], options.exclude);
  await executeStatementBatches(db, rowParamLimitedChunks(values).map((chunk) =>
    db.insert(table).values(chunk).onConflictDoUpdate({
      target,
      set: excludedUpdateSet<TTable>(updateColumns),
    })
  ));
}

export async function upsertOne<TTable extends AnySQLiteTable>(
  db: DB,
  table: TTable,
  target: ConflictTarget,
  value: InsertRow<TTable>,
  options: BulkUpsertOptions = {},
) {
  await bulkUpsert(db, table, target, [value], options);
}

function inferUpdateColumns<TTable extends AnySQLiteTable>(
  table: TTable,
  target: ConflictTarget,
  sample: InsertRow<TTable>,
  exclude: string[] = [],
): ConflictUpdateColumns {
  const targetNames = new Set((Array.isArray(target) ? target : [target]).map((column) => column.name));
  const excludedKeys = new Set(["id", ...exclude]);
  const tableColumns = table as unknown as Record<string, AnySQLiteColumn>;

  return Object.fromEntries(
    Object.keys(sample as object).flatMap((key) => {
      const column = tableColumns[key];
      if (!column || excludedKeys.has(key) || targetNames.has(column.name)) return [];
      return [[key, column]];
    }),
  );
}

export async function deleteWhereIn<TTable extends AnySQLiteTable, TValue>(
  db: DB,
  table: TTable,
  column: AnySQLiteColumn,
  values: TValue[],
) {
  await executeStatementBatches(db, deleteWhereInStatements(db, table, column, values));
}

export function deleteWhereInStatements<TTable extends AnySQLiteTable, TValue>(
  db: DB,
  table: TTable,
  column: AnySQLiteColumn,
  values: TValue[],
) {
  return chunkArray(values, D1_MAX_STATEMENT_PARAMS).map((chunk) => db.delete(table).where(inArray(column, chunk)));
}

export async function executeStatementBatches(db: DB, statements: BatchStatement[]) {
  for (const chunk of chunkArray(statements, D1_MAX_BATCH_STATEMENTS)) {
    if (chunk.length === 0) continue;
    await db.batch(chunk as [BatchStatement, ...BatchStatement[]]);
  }
}
