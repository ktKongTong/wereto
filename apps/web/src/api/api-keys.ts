import type { Context } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { createMiddleware } from "hono/factory";

import type { DbEnv } from "./db/client.ts";

type ApiEnv = { Bindings: DbEnv };
type ApiContext = Context<ApiEnv>;

export const requireApiKey = createMiddleware<ApiEnv>(async (c, next) => {
  const verify = async (key: string) => Boolean(await c.get("repos").apiKeys.verify(key));
  const headerKey = c.req.header("x-api-key")?.trim();

  if (headerKey) {
    if (await verify(headerKey)) {
      await next();
      return;
    }

    return c.json({ error: "Unauthorized" }, 401);
  }

  const bearer = bearerAuth<ApiEnv>({
    verifyToken: async (token) => verify(token),
  });

  return bearer(c, next);
});

export async function listApiKeys(c: ApiContext): Promise<Response> {
  return c.json(await c.get("repos").apiKeys.listActive());
}

export async function createApiKey(c: ApiContext): Promise<Response> {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  return c.json(await c.get("repos").apiKeys.create(body.name ?? ""), 201);
}

export async function revokeApiKey(c: ApiContext): Promise<Response> {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: "Invalid API key id" }, 400);
  }

  await c.get("repos").apiKeys.revoke(id);
  return c.json({ ok: true });
}
