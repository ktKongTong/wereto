import { defineConfig } from "rolldown";
import { isolatedDeclarationPlugin } from "rolldown/experimental";

export default defineConfig({
  input: "./src/index.ts",
  external: ["ky", /^node:/],
  plugins: [isolatedDeclarationPlugin()],
  output: {
    dir: "dist",
    format: "esm",
    sourcemap: true,
    entryFileNames: "[name].js",
  },
  platform: "node",
  tsconfig: "./tsconfig.json",
});
