import { Hono, type ExecutionContext } from "hono";
import { createRequestHandler } from "react-router";

import { createApp } from "../api/app";


export const createRRApp = () => {
  const app = new Hono();

  app.route("/api", createApp());
  const requestHandler = createRequestHandler(
    () => import("virtual:react-router/server-build"),
    import.meta.env.MODE,
  );
  app.all("*", (c) =>
    requestHandler(c.req.raw, {
      cloudflare: { env: c.env, ctx: c.executionCtx as ExecutionContext },
    }),
  );

  return app;
};
