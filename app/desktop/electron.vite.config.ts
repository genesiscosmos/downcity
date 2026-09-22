/** Downcity Desktop 的 Electron/Vite 三端构建配置。 */
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { "@": resolve("src/main") } },
    build: { rollupOptions: { output: { format: "es", entryFileNames: "[name].mjs" } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    resolve: {
      alias: { "@": resolve("src/renderer"), "@common": resolve("src/common") },
      dedupe: ["react", "react-dom"],
    },
    // 关键点（中文）：Mermaid 包含动态图表模块和 CommonJS 依赖；作为直接依赖在启动阶段完整预构建。
    // 注意：这只作用于开发期依赖预构建，`vite build` 走 Rollup、不读取它。
    optimizeDeps: { include: ["mermaid"] },
    // 关键点（中文）：高亮 Worker 依赖 Shiki 的动态 import（按需加载语言），必须输出 ES 模块；
    // Vite 默认的 iife 不支持代码分割，会在构建期直接报错。
    worker: { format: "es" },
    plugins: [tailwindcss(), react()],
    server: {
      host: "127.0.0.1",
      port: 6173,
      strictPort: false,
    },
  },
});
