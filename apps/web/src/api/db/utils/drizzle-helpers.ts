import { type SQL, sql } from "drizzle-orm";
import type { AnySQLiteColumn, AnySQLiteTable, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";

export type ConflictUpdateColumns = Record<string, AnySQLiteColumn>;

export function excluded(column: AnySQLiteColumn): SQL {
  return sql.raw(`excluded.${column.name}`);
}

export function excludedUpdateSet<TTable extends AnySQLiteTable>(columns: ConflictUpdateColumns): SQLiteUpdateSetSource<TTable> {
  return Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, excluded(column)])) as SQLiteUpdateSetSource<TTable>;
}
