import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  layout("routes/layout.tsx", [
    index("routes/history.tsx"),
    route("archive", "routes/archive.tsx"),
  ]),
] satisfies RouteConfig;
