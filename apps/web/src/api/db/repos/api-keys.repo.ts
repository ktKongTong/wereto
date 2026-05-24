import { and, desc, eq, isNull } from "drizzle-orm";

import type { DB } from "../client.ts";
import { apiKeys } from "../schema.ts";
import { nowUnix } from "../../time.ts";

export type ApiKeyRecord = {
  id: number;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
};

export class ApiKeysRepo {
  constructor(private readonly db: DB) {}

  async listActive(): Promise<ApiKeyRecord[]> {
    const rows = await this.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.keyPrefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
      })
      .from(apiKeys)
      .where(isNull(apiKeys.revokedAt))
      .orderBy(desc(apiKeys.createdAt));

    return rows;
  }

  async create(name: string): Promise<{ key: string; item: ApiKeyRecord }> {
    const key = createApiKeyToken();
    const keyHash = await sha256Hex(key);
    const createdAt = nowUnix();
    const keyPrefix = key.slice(0, 12);
    const [item] = await this.db
      .insert(apiKeys)
      .values({
        name: name.trim() || "Default",
        keyHash,
        keyPrefix,
        createdAt,
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.keyPrefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
      });

    if (!item) {
      throw new Error("Failed to create API key");
    }

    return { key, item };
  }

  async revoke(id: number): Promise<void> {
    await this.db.update(apiKeys).set({ revokedAt: nowUnix() }).where(eq(apiKeys.id, id));
  }

  async verify(key: string): Promise<ApiKeyRecord | null> {
    const keyHash = await sha256Hex(key);
    const [item] = await this.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.keyPrefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
      .limit(1);

    if (!item) return null;

    await this.db.update(apiKeys).set({ lastUsedAt: nowUnix() }).where(eq(apiKeys.id, item.id));
    return item;
  }
}

function createApiKeyToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `wr_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
