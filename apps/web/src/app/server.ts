import { Hono, type ExecutionContext } from "hono";
import { createRequestHandler } from "react-router";

import { createApp, type ServerOptions } from "../api/app";

type Runtime = "node" | "workerd" | "deno" | "bun" | "vercel";

type CreateRRAppOptions = {
  api: ServerOptions;
  runtime: Runtime;
};

export const createRRApp = ({ api, runtime }: CreateRRAppOptions) => {
  const app = new Hono();

  app.route("/api", createApp(api));

  if (runtime === "workerd" || runtime === "vercel") {
    const requestHandler = createRequestHandler(
      () => import("virtual:react-router/server-build"),
      import.meta.env.MODE,
    );

    switch (runtime) {
      case "workerd":
        app.all("*", (c) =>
          requestHandler(c.req.raw, {
            cloudflare: { env: c.env, ctx: c.executionCtx as ExecutionContext },
          }),
        );
        break;
      case "vercel":
        app.all("*", (c) =>
          requestHandler(c.req.raw, {
            runtime: "vercel",
            env: process.env,
          }),
        );
        break;
    }
  }

  return app;
};
