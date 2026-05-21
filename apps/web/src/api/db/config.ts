import { eq } from "drizzle-orm";

import type { DB } from "./client.ts";
import { appConfig } from "./schema.ts";

export async function getConfigValue(db: DB, key: string) {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.key, key)).limit(1);
  return row?.value ?? null;
}

export async function upsertConfigValue(db: DB, key: string, value: string) {
  await db
    .insert(appConfig)
    .values({
      key,
      value,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: {
        value,
        updatedAt: Math.floor(Date.now() / 1000),
      },
    });
}

export async function getBooleanConfig(db: DB, key: string, defaultValue = false) {
  const value = await getConfigValue(db, key);
  if (value === null) {
    return defaultValue;
  }
  return value === "true" || value === "1";
}

export async function upsertBooleanConfig(db: DB, key: string, value: boolean) {
  await upsertConfigValue(db, key, value ? "true" : "false");
}
