import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

export default defineConfig(() => {
  return {
    plugins: [
      cloudflare({
        viteEnvironment: { name: "ssr" },
        configPath: '../../wrangler.jsonc',
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
