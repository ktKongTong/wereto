import { Hono } from "hono";

import { createApiKey, listApiKeys, requireApiKey, revokeApiKey } from "./api-keys.ts";
import { getAccountSettings, getPublicSetting, login, logout, requireAuth, requireAuthOrPublic, session, setApiKey, setPassword, setPublicSetting } from "./auth";
import { getDB, type DB, type DbEnv } from "./db/client.ts";
import { createRepoCtx, type RepoCtx } from "./db/repos/ctx.ts";
import { invalidateAllResponseCache, responseCache, type KvCacheEnv } from "./kv-cache.ts";
import { getArchiveReadModel } from "./read-models/archive.read-model.ts";
import { getRecentAnnotationModel, getRecentReadModel } from "./read-models/external.read-model.ts";
import { getHistoryReadModel } from "./read-models/history.read-model.ts";
import { startWereadSync } from "./sync";
import { type SyncRunStateEnv } from "./do/sync-run-state.ts";
import {getSyncRun} from "@/api/sync-run.ts";
import type {WereadSyncDispatchEnv} from "@/api/sync-queue.ts";

declare module "hono" {
  interface ContextVariableMap {
    db: DB;
    repos: RepoCtx;
  }
}
export const createApp = () => {
  const app = new Hono<{ Bindings: DbEnv & SyncRunStateEnv & WereadSyncDispatchEnv & KvCacheEnv }>();
  app.use('*', async (c, next) => {
    const db = getDB(c.env);
    c.set("db", db);
    c.set("repos", createRepoCtx(db));
    await next();
  });

  app.get("/auth/session", session);
  app.post("/auth/login", login);
  app.post("/auth/logout", logout);
  app.get("/settings/public", getPublicSetting);
  app.get("/settings/account", requireAuth, getAccountSettings);
  app.post("/settings/public", requireAuth, setPublicSetting);
  app.post("/settings/password", requireAuth, setPassword);
  app.post("/settings/weread-api-key", requireAuth, setApiKey);
  app.post("/settings/cache/clear", requireAuth, async (c) => {
    await invalidateAllResponseCache(c.env);
    return c.json({ ok: true });
  });
  app.get("/settings/api-keys", requireAuth, listApiKeys);
  app.post("/settings/api-keys", requireAuth, createApiKey);
  app.delete("/settings/api-keys/:id", requireAuth, revokeApiKey);

  app.use("/sync/*", requireAuth);
  app.use("/query/*", requireAuthOrPublic);

  app.use("/query/*", responseCache());
  app.use("/recent/*", responseCache());
  app.use("/export", responseCache());

  app.post("/sync/weread", async (c) => c.json(await startWereadSync(c)));
  app.get("/sync/runs", async (c) => c.json(await c.get("repos").runs.list(20)));
  app.get("/sync/runs/:id", getSyncRun);

  app.get("/query/history", async (c) => c.json(await getHistoryReadModel(c.get("repos"))));
  app.get("/query/archive", async (c) => c.json(await getArchiveReadModel(c.get("repos"))));
  app.get("/recent/read",requireApiKey, async (c) => c.json(await getRecentReadModel(c.get("repos"))));
  app.get("/recent/annotation", async (c) => c.json(await getRecentAnnotationModel(c.get("repos"))));
  app.get("/export", requireApiKey, async (c) =>
    c.json({
      history: await getHistoryReadModel(c.get("repos")),
      archive: await getArchiveReadModel(c.get("repos")),
    }),
  );

  return app;
};
