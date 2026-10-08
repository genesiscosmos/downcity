/**
 * Homepage 的 Vite 配置。
 *
 * 关键说明（中文）
 * - homepage 运行在 monorepo 内部，需要直接消费 workspace 包源码。
 * - Vercel 在构建 homepage 时不会自动先构建 `packages/ui/dist`。
 * - 因此这里显式把 `@downcity/ui` 解析到源码入口，避免依赖未生成的 dist 产物。
 */
import { reactRouter } from "@react-router/dev/vite";
import mdx from "fumadocs-mdx/vite";
import * as MdxConfig from "./source.config";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  base: "/",
  plugins: [tailwindcss(), mdx(MdxConfig), reactRouter()],
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: /^@\//,
        replacement: path.resolve(__dirname, "./app/") + "/",
      },
      {
        find: /^~\//,
        replacement: path.resolve(__dirname, "./app/") + "/",
      },
      {
        find: "@/.source",
        replacement: path.resolve(__dirname, "./.source/server"),
      },
      {
        find: "@downcity/ui/source.css",
        replacement: path.resolve(
          __dirname,
          "../packages/ui/src/source.css",
        ),
      },
      {
        find: "@downcity/ui/styles.css",
        replacement: path.resolve(
          __dirname,
          "../packages/ui/src/styles.css",
        ),
      },
      {
        find: /^@downcity\/ui$/,
        replacement: path.resolve(
          __dirname,
          "../packages/ui/src/index.ts",
        ),
      },
    ],
  },
});
