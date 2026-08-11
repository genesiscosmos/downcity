/** Downcity Desktop 的 Electron/Vite 三端构建配置。 */
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@downcity/agent", "@downcity/agent-registry"] })],
    resolve: { alias: { "@": resolve("src/main") } },
    build: { rollupOptions: { output: { format: "es", entryFileNames: "[name].mjs" } } },
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] },
});
