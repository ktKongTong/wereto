import { Hono } from "hono";

import { getAccountSettings, getPublicSetting, login, logout, requireAuth, requireAuthOrPublic, session, setApiKey, setPassword, setPublicSetting } from "./auth";
import { getDB, type DB, type DbEnv } from "./db/client.ts";
import { createRepoCtx, type RepoCtx } from "./db/repos/ctx.ts";
import { getArchiveReadModel } from "./read-models/archive.read-model.ts";
import { getHistoryReadModel } from "./read-models/history.read-model.ts";
import { startWereadSync } from "./sync";

declare module "hono" {
  interface ContextVariableMap {
    db: DB;
    repos: RepoCtx;
  }
}
export const createApp = () => {
  const app = new Hono<{ Bindings: DbEnv }>();
  app.use('*', async (c, next) => {
    const db = getDB(c.env);
    c.set("db", db);
    c.set("repos", createRepoCtx(db));
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/auth/session", session);
  app.post("/auth/login", login);
  app.post("/auth/logout", logout);
  app.get("/settings/public", getPublicSetting);
  app.get("/settings/account", requireAuth, getAccountSettings);
  app.post("/settings/public", requireAuth, setPublicSetting);
  app.post("/settings/password", requireAuth, setPassword);
  app.post("/settings/weread-api-key", requireAuth, setApiKey);

  app.use("/sync/*", requireAuth);
  app.use("/query/*", requireAuthOrPublic);

  app.post("/sync/weread", async (c) => c.json(await startWereadSync(c)));
  app.get("/sync/runs", async (c) => c.json(await c.get("repos").runs.list(20)));
  app.get("/sync/runs/:id", async (c) => {
    const run = await c.get("repos").runs.getWithLogs(Number(c.req.param("id")));
    if (!run) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(run);
  });

  app.get("/query/history", async (c) => c.json(await getHistoryReadModel(c.get("repos"))));
  app.get("/query/archive", async (c) => c.json(await getArchiveReadModel(c.get("repos"))));

  return app;
};
