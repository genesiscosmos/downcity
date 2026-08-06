/** Fedman 浏览器入口。 */

import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

const root = document.querySelector("#root");
if (!root) throw new Error("Fedman root element is missing.");
createRoot(root).render(<App />);
