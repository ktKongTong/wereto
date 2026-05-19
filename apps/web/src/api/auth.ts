import type { AppDb } from "./db/client.ts";
import { getBooleanConfig, getConfigValue, upsertBooleanConfig, upsertConfigValue } from "./db/config.ts";

const AUTH_COOKIE = "weread_session";

export async function isAuthenticated(request: Request, db: AppDb): Promise<boolean> {
  const password = await getPassword(db);
  const cookie = request.headers.get("cookie") ?? "";
  return password ? parseCookie(cookie)[AUTH_COOKIE] === createSessionValue(password) : false;
}

export async function requireAuth(request: Request, db: AppDb): Promise<Response | null> {
  if (await isAuthenticated(request, db)) {
    return null;
  }

  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export async function requireAuthOrPublic(request: Request, db: AppDb): Promise<Response | null> {
  if ((await isPublic(db)) || (await isAuthenticated(request, db))) {
    return null;
  }

  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export async function login(request: Request, db: AppDb): Promise<Response> {
  const password = await getPassword(db);
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  if (!password || body.password !== password) {
    return Response.json({ ok: false, error: "Invalid password" }, { status: 401 });
  }

  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", serializeCookie(AUTH_COOKIE, createSessionValue(password)));
  return response;
}

export function logout(): Response {
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", serializeCookie(AUTH_COOKIE, "", { maxAge: 0 }));
  return response;
}

export async function session(request: Request, db: AppDb): Promise<Response> {
  return Response.json({
    authenticated: await isAuthenticated(request, db),
    public: await isPublic(db),
    passwordChanged: await getBooleanConfig(db, "auth.passwordChanged", false),
    hasApiKey: Boolean(await getConfigValue(db, "weread.apiKey")),
  });
}

export async function getPublicSetting(db: AppDb): Promise<Response> {
  return Response.json({ public: await isPublic(db) });
}

export async function setPublicSetting(request: Request, db: AppDb): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { public?: boolean };
  await upsertBooleanConfig(db, "site.public", Boolean(body.public));
  return Response.json({ public: Boolean(body.public) });
}

export async function getAccountSettings(db: AppDb): Promise<Response> {
  return Response.json({
    public: await isPublic(db),
    passwordChanged: await getBooleanConfig(db, "auth.passwordChanged", false),
    hasApiKey: Boolean(await getConfigValue(db, "weread.apiKey")),
  });
}

export async function setPassword(request: Request, db: AppDb): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  const nextPassword = body.password?.trim() ?? "";
  if (nextPassword.length < 4) {
    return Response.json({ ok: false, error: "Password must be at least 4 characters" }, { status: 400 });
  }

  await upsertConfigValue(db, "auth.password", nextPassword);
  await upsertBooleanConfig(db, "auth.passwordChanged", true);

  const response = Response.json({ ok: true, passwordChanged: true });
  response.headers.append("Set-Cookie", serializeCookie(AUTH_COOKIE, createSessionValue(nextPassword)));
  return response;
}

export async function setApiKey(request: Request, db: AppDb): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { apiKey?: string };
  const apiKey = body.apiKey?.trim() ?? "";
  if (!apiKey) {
    return Response.json({ ok: false, error: "API key is required" }, { status: 400 });
  }

  await upsertConfigValue(db, "weread.apiKey", apiKey);
  return Response.json({ ok: true, hasApiKey: true });
}

async function isPublic(db: AppDb) {
  return getBooleanConfig(db, "site.public", false);
}

function createSessionValue(password: string): string {
  return `ok:${password}`;
}

async function getPassword(db: AppDb) {
  const passwordChanged = await getBooleanConfig(db, "auth.passwordChanged", false);
  const existing = await getConfigValue(db, "auth.password");
  if (existing && passwordChanged) {
    return existing;
  }

  await upsertConfigValue(db, "auth.password", "weread");
  await upsertBooleanConfig(db, "auth.passwordChanged", false);
  return "weread";
}

function parseCookie(value: string): Record<string, string> {
  return Object.fromEntries(
    value
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, ...rest] = part.split("=");
        return [key, rest.join("=")];
      }),
  );
}

function serializeCookie(name: string, value: string, options: { maxAge?: number } = {}): string {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  return parts.join("; ");
}
