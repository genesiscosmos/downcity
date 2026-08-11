/** City Web 浏览器入口。 */
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("City Web root element is missing.");
createRoot(root).render(<App />);

