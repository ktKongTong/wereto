import { createRRApp } from "../src/app/server";
import { createHonoServer } from "react-router-hono-server/node";

const app = createRRApp({
  runtime: "node",
  api: {
    adapter: {},
  },
});

export default createHonoServer({
  app,
});
