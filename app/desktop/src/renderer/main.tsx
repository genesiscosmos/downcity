/** Downcity Desktop Renderer 入口。 */
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/base.css";

/** 跟随系统外观设置 Duobox 默认主题使用的 dark class。 */
function sync_color_scheme() {
  document.documentElement.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);
}

sync_color_scheme();
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", sync_color_scheme);

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
