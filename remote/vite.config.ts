/** Remote 静态应用构建：仅引入 City 的浏览器入口，样式由 Tailwind 与 UI SDK 提供。 */
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [react(), tailwindcss()] });
