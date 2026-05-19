import { createHonoServer } from "react-router-hono-server/bun";

import { createRRApp } from "../src/app/server";

const app = createRRApp({
  runtime: "bun",
  api: {
    adapter: {},
  },
});

export default createHonoServer({
  app,
});
