import { getDb, type DbEnv } from "./client.ts";

export function getDbBindingForRequest(env?: Partial<DbEnv>) {
  if (env?.DB) {
    return env.DB;
  }

  throw new Error("Missing D1 DB binding. Run the web app in a runtime that provides env.DB.");
}

export function getDbForRequest(env?: Partial<DbEnv>) {
  return getDb({ DB: getDbBindingForRequest(env) });
}
