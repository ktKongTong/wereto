import { createHonoServer } from "react-router-hono-server/deno";

import { createRRApp } from "../src/app/server";

const app = createRRApp({
  runtime: "deno",
  api: {
    adapter: {},
  },
});

export default createHonoServer({
  app,
});
