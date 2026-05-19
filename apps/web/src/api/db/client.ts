import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema.ts";

export interface DbEnv {
  DB: D1Database;
}

export function getDb(env: DbEnv) {
  return drizzle(env.DB, { schema });
}

export type AppDb = ReturnType<typeof getDb>;
