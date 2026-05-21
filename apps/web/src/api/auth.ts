import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";

import type { DB } from "./db/client.ts";
import type { DbEnv } from "./db/client.ts";
import { getBooleanConfig, getConfigValue, upsertBooleanConfig, upsertConfigValue } from "./db/config.ts";

const AUTH_COOKIE = "weread_session";

type ApiContext = Context<{ Bindings: DbEnv }>;

const cookieOptions = {
  path: "/",
  httpOnly: true,
  sameSite: "Lax",
} as const;

export async function isAuthenticated(c: ApiContext, db: DB): Promise<boolean> {
  const password = await getPassword(db);
  return password ? (await getSignedCookie(c, password, AUTH_COOKIE)) === "1" : false;
}

export const requireAuth = createMiddleware<{ Bindings: DbEnv }>(async (c, next) => {
  if (!(await isAuthenticated(c, c.get("db")))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
});

export const requireAuthOrPublic = createMiddleware<{ Bindings: DbEnv }>(async (c, next) => {
  const db = c.get("db");
  if (!(await isPublic(db)) && !(await isAuthenticated(c, db))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
});

export async function login(c: ApiContext): Promise<Response> {
  const db = c.get("db");
  const password = await getPassword(db);
  const body = (await c.req.json().catch(() => ({}))) as { password?: string };
  if (!password || body.password !== password) {
    return c.json({ ok: false, error: "Invalid password" }, 401);
  }

  await setAuthCookie(c, password);
  return c.json({ ok: true });
}

export function logout(c: ApiContext): Response {
  deleteCookie(c, AUTH_COOKIE, { path: "/" });
  return c.json({ ok: true });
}

export async function session(c: ApiContext): Promise<Response> {
  const db = c.get("db");
  return c.json({
    authenticated: await isAuthenticated(c, db),
    public: await isPublic(db),
    passwordChanged: await getBooleanConfig(db, "auth.passwordChanged", false),
    hasApiKey: Boolean(await getConfigValue(db, "weread.apiKey")),
  });
}

export async function getPublicSetting(c: ApiContext): Promise<Response> {
  return c.json({ public: await isPublic(c.get("db")) });
}

export async function setPublicSetting(c: ApiContext): Promise<Response> {
  const db = c.get("db");
  const body = (await c.req.json().catch(() => ({}))) as { public?: boolean };
  await upsertBooleanConfig(db, "site.public", Boolean(body.public));
  return c.json({ public: Boolean(body.public) });
}

export async function getAccountSettings(c: ApiContext): Promise<Response> {
  const db = c.get("db");
  return c.json({
    public: await isPublic(db),
    passwordChanged: await getBooleanConfig(db, "auth.passwordChanged", false),
    hasApiKey: Boolean(await getConfigValue(db, "weread.apiKey")),
  });
}

export async function setPassword(c: ApiContext): Promise<Response> {
  const db = c.get("db");
  const body = (await c.req.json().catch(() => ({}))) as { password?: string };
  const nextPassword = body.password?.trim() ?? "";
  if (nextPassword.length < 4) {
    return c.json({ ok: false, error: "Password must be at least 4 characters" }, 400);
  }

  await upsertConfigValue(db, "auth.password", nextPassword);
  await upsertBooleanConfig(db, "auth.passwordChanged", true);
  await setAuthCookie(c, nextPassword);
  return c.json({ ok: true, passwordChanged: true });
}

export async function setApiKey(c: ApiContext): Promise<Response> {
  const body = (await c.req.json().catch(() => ({}))) as { apiKey?: string };
  const apiKey = body.apiKey?.trim() ?? "";
  if (!apiKey) {
    return c.json({ ok: false, error: "API key is required" }, 400);
  }

  await upsertConfigValue(c.get("db"), "weread.apiKey", apiKey);
  return c.json({ ok: true, hasApiKey: true });
}

async function isPublic(db: DB) {
  return getBooleanConfig(db, "site.public", false);
}

async function setAuthCookie(c: ApiContext, password: string) {
  await setSignedCookie(c, AUTH_COOKIE, "1", password, cookieOptions);
}

async function getPassword(db: DB) {
  const existing = await getConfigValue(db, "auth.password");
  return existing
}
