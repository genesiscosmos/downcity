/** 浏览器入口：装载共享 UI 样式、Remote 主题与应用，不创建后台服务。 */
import { StrictMode } from "react";
import { createRoot as create_root } from "react-dom/client";
import { Remote_app } from "./app";
import "./styles.css";

const root_element = document.getElementById("root");
if (!root_element) throw new Error("Remote application root is missing.");
create_root(root_element).render(<StrictMode><Remote_app /></StrictMode>);
