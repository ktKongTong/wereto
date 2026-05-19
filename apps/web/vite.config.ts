import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";
import { reactRouterHonoServer } from "react-router-hono-server/dev";

export default defineConfig(() => {
  const runtime = process.env.RUNTIME ?? "node";
  const runtimePlugins: any[] = [];

  switch (runtime) {
    case "workerd":
      runtimePlugins.push(
        cloudflare({
          viteEnvironment: { name: "ssr" },
        }),
      );
      break;
    case "deno":
    case "bun":
    case "node":
      runtimePlugins.push(
        reactRouterHonoServer({
          serverEntryPoint: `./entry/${runtime}.ts`,
          runtime,
        }),
      );
      break;
  }

  return {
    plugins: [...runtimePlugins, tailwindcss(), reactRouter()],
    resolve: {
      tsconfigPaths: true,
    },
    server: {
      watch: {
        ignored: ["**/.wrangler/**"],
      },
    },
  };
});
