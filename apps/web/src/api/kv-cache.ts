import type { Context, MiddlewareHandler } from "hono";

export type KvCacheEnv = {
  KV: KVNamespace;
};

const CACHE_VERSION_KEY = "cache:response:version";
const CACHE_KEY_PREFIX = "cache:response";

export function responseCache(): MiddlewareHandler<{ Bindings: KvCacheEnv }> {
  return async (c, next) => {
    if (c.req.method !== "GET") {
      await next();
      return;
    }

    const key = await responseCacheKey(c.env, cacheIdFromContext(c));
    const cached = await c.env.KV.get(key);
    if (cached !== null) {
      return new Response(cached, {
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "x-kv-cache": "hit",
        },
      });
    }

    await next();

    const contentType = c.res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json") || c.res.status < 200 || c.res.status >= 300) {
      return;
    }

    const body = await c.res.clone().text();
    c.executionCtx.waitUntil(c.env.KV.put(key, body));
    c.res.headers.set("x-kv-cache", "miss");
  };
}

export async function invalidateAllResponseCache(env: KvCacheEnv) {
  await env.KV.put(CACHE_VERSION_KEY, crypto.randomUUID());
}

async function responseCacheKey(env: KvCacheEnv, cacheId: string) {
  const version = await env.KV.get(CACHE_VERSION_KEY);
  return `${CACHE_KEY_PREFIX}:${version ?? "0"}:${cacheId}`;
}

function cacheIdFromContext(c: Context) {
  const url = new URL(c.req.url);
  return `${c.req.method}:${url.pathname}${url.search}`;
}
