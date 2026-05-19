import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";
import { reactRouterHonoServer } from "react-router-hono-server/dev";

export default defineConfig(() => {
  return {
    plugins: [
      cloudflare({
        viteEnvironment: { name: "ssr" },
      })
      , tailwindcss(), reactRouter()],
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
