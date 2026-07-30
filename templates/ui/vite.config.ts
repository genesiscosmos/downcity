/**
 * UI 展示应用的 Vite 构建配置。
 *
 * 该模板只负责预览 `@downcity/ui`，因此不配置服务端代理或业务运行时。
 */

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
  },
});
