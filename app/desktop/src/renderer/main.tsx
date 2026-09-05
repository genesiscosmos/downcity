/** Downcity Desktop Renderer 入口。 */
import * as React from "react";
import * as jsx_runtime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./locales/i18n";
import "./styles/base.css";

declare global {
  /** Plugin Renderer ESM 共享的宿主 React runtime。 */
  var __DOWNCITY_REACT__: typeof React | undefined;

  /** Plugin Renderer ESM 共享的宿主 JSX runtime。 */
  var __DOWNCITY_JSX_RUNTIME__: typeof jsx_runtime | undefined;
}

globalThis.__DOWNCITY_REACT__ = React;
globalThis.__DOWNCITY_JSX_RUNTIME__ = jsx_runtime;

// 关键点（中文）：Controller 读取持久化设置前先使用无闪烁的系统默认外观。
document.documentElement.dataset.theme = "duobox";
document.documentElement.lang = "en";
document.documentElement.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
