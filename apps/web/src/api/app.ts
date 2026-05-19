import { Hono } from "hono";
import { getAccountSettings, getPublicSetting, login, logout, requireAuth, requireAuthOrPublic, session, setApiKey, setPassword, setPublicSetting } from "./auth";
import { getDb, type DbEnv } from "./db/client.ts";

import { startWereadSync } from "./sync";
import { getArchiveFromDb, getHistoryFromDb, getSyncRunById, listSyncRuns } from "./db/queries";
export type ServerOptions = {
  adapter?: unknown;
};

declare module "hono" {
  interface ContextVariableMap {
    db: ReturnType<typeof getDb>;
  }
}
export const createApp = (_options: ServerOptions) => {
  const app = new Hono<{ Bindings: DbEnv }>();
  app.use('*', async (c, next) => {
    c.set("db", getDb(c.env));
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/auth/session", async (c) => session(c.req.raw,c.get('db')));
  app.post("/auth/login", async (c) => login(c.req.raw, c.get('db')));
  app.post("/auth/logout", () => logout());
  app.get("/settings/public", async (c) => getPublicSetting(c.get('db')));
  app.get("/settings/account", async (c) => {
    const db = c.get('db');
    const unauthorized = await requireAuth(c.req.raw, db);
    if (unauthorized) {
      return unauthorized;
    }
    return getAccountSettings(db);
  });
  app.post("/settings/public", async (c) => {
    const unauthorized = await requireAuth(c.req.raw, c.get('db'));
    if (unauthorized) {
      return unauthorized;
    }
    return setPublicSetting(c.req.raw, c.get('db'));
  });
  app.post("/settings/password", async (c) => {
    const db = c.get('db');
    const unauthorized = await requireAuth(c.req.raw, db);
    if (unauthorized) {
      return unauthorized;
    }
    return setPassword(c.req.raw, db);
  });
  app.post("/settings/weread-api-key", async (c) => {
    const db = c.get('db');
    const unauthorized = await requireAuth(c.req.raw, db);
    if (unauthorized) {
      return unauthorized;
    }
    return setApiKey(c.req.raw, db);
  });

  app.use("/sync/*", async (c, next) => {
    const unauthorized = await requireAuth(c.req.raw, c.get('db'));
    if (unauthorized) {
      return unauthorized;
    }
    await next();
  });

  app.use("/query/*", async (c, next) => {
    const unauthorized = await requireAuthOrPublic(c.req.raw, c.get('db'));
    if (unauthorized) {
      return unauthorized;
    }
    await next();
  });

  app.post("/sync/weread", async (c) => c.json(await startWereadSync(c)));
  app.get("/sync/runs", async (c) => c.json(await listSyncRuns(c.get('db'))));
  app.get("/sync/runs/:id", async (c) => {

    const run = await getSyncRunById(c.get('db'), Number(c.req.param("id")));
    if (!run) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(run);
  });

  app.get("/query/history", async (c) => c.json(await getHistoryFromDb(c.get('db'))));
  app.get("/query/archive", async (c) => c.json(await getArchiveFromDb(c.get('db'))));

  return app;
};
