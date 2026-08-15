/** Downcity Desktop Renderer 入口。 */
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/base.css";

// 关键点（中文）：Controller 读取持久化设置前先使用无闪烁的系统默认外观。
document.documentElement.dataset.theme = "duobox";
document.documentElement.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
