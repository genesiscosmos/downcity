/**
 * Fedman 静态控制面的 Vite 构建配置。
 *
 * CLI 会复制完整 dist，因此这里使用相对资源路径，确保编译产物既能被
 * `fed web` 托管，也能独立检查构建结果。
 */

import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      { find: "@downcity/ui/source.css", replacement: path.resolve(__dirname, "../ui/src/source.css") },
      { find: "@downcity/ui/styles.css", replacement: path.resolve(__dirname, "../ui/src/styles.css") },
      { find: /^@downcity\/ui$/, replacement: path.resolve(__dirname, "../ui/src/index.ts") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 43129,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:43128",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
