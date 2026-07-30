/**
 * Downcity UI 展示应用入口。
 *
 * 入口只负责挂载 React；组件示例与展示状态统一由 App 管理。
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("缺少 React 根节点");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
