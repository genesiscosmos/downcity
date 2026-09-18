/** Downcity Desktop Renderer 入口。 */
import * as React from "react";
import * as jsx_runtime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import { App } from "./App";
import "./locales/i18n";
import "./styles/base.css";

declare global {
  /** Power Renderer ESM 共享的宿主 React runtime。 */
  var __DOWNCITY_REACT__: typeof React | undefined;

  /** Power Renderer ESM 共享的宿主 JSX runtime。 */
  var __DOWNCITY_JSX_RUNTIME__: typeof jsx_runtime | undefined;
}

globalThis.__DOWNCITY_REACT__ = React;
globalThis.__DOWNCITY_JSX_RUNTIME__ = jsx_runtime;

// 关键点（中文）：Controller 读取持久化设置前先使用无闪烁的系统默认外观。
document.documentElement.dataset.theme = "duobox";
document.documentElement.lang = "en";
document.documentElement.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/*
      系统开启「减少动态效果」时，一次性关掉全部 framer-motion 动画。

      在此之前只有 4 处组件各自带了 motion-reduce 分支，而侧栏、BayBar、两侧折叠按钮
      的尺寸动画都没有处理——这类动画最容易引起前庭不适。逐个补容易再漏，
      因此在根部统一收口；CSS 过渡部分由各元素自己的 motion-reduce 负责。
    */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>,
);
