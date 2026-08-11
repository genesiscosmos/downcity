/** Downcity Desktop 的 Electron/Vite 三端构建配置。 */
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@downcity/agent", "@downcity/agent-registry"] })],
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
    plugins: [tailwindcss(), react()],
    server: {
      host: "127.0.0.1",
      port: 6173,
      strictPort: true,
    },
  },
});
