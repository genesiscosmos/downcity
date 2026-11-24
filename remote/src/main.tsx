/** 浏览器入口：装载共享 UI 样式、Remote 主题与应用，不创建后台服务。 */
import { StrictMode, Suspense, lazy } from "react";
import { createRoot as create_root } from "react-dom/client";
import { Remote_app } from "./app";
import "./styles.css";

const root_element = document.getElementById("root");
if (!root_element) throw new Error("Remote application root is missing.");
// Vite removes this branch and its lazy fixture chunk from production builds.
const Application = import.meta.env.DEV && window.location.pathname === "/__showcase"
  ? lazy(() => import("./dev/showcase").then(module => ({ default: module.Remote_showcase })))
  : Remote_app;
create_root(root_element).render(<StrictMode><Suspense fallback={<p role="status">Loading preview…</p>}><Application /></Suspense></StrictMode>);
