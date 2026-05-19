import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  appDirectory: "src/app",
  future: {
    v8_viteEnvironmentApi: process.env.RUNTIME === "bun" ? false : true,
  },
} satisfies Config;
