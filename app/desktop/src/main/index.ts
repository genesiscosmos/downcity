/** Downcity Desktop Electron 主进程入口。 */
import { app, BrowserWindow, ipcMain, nativeImage } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentController } from "@/agent/AgentController.js";

const current_directory = path.dirname(fileURLToPath(import.meta.url));
const development_macos_icon_path = path.join(current_directory, "../../build/icon.iconset/icon_512x512@2x.png");
const development_window_icon_path = path.join(current_directory, "../../build/icons/512x512.png");
const agent_controller = new AgentController();
let quitting = false;

/** 在 Electron 开发进程中设置平台原生图标。 */
function configure_development_icon(): void {
  if (!process.env.ELECTRON_RENDERER_URL || process.platform !== "darwin") return;
  const icon = nativeImage.createFromPath(development_macos_icon_path);
  if (icon.isEmpty()) return;
  app.dock?.setIcon(icon);
}

function create_window(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 760,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    ...(process.platform === "darwin" ? { trafficLightPosition: { x: 12, y: 13 } } : {}),
    ...(process.env.ELECTRON_RENDERER_URL && process.platform !== "darwin" ? { icon: development_window_icon_path } : {}),
    backgroundColor: "#f7f7f6",
    webPreferences: { preload: path.join(current_directory, "../preload/index.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else window.loadFile(path.join(current_directory, "../renderer/index.html"));
  window.once("ready-to-show", () => window.show());
  return window;
}

ipcMain.handle("agent:list", () => agent_controller.list_agents());
ipcMain.handle("agent:create", (_event, agent_id: string, workspace_path: string, model_id: string) => agent_controller.create_agent(agent_id, workspace_path, model_id));
ipcMain.handle("workspace:list", () => agent_controller.list_workspaces());
ipcMain.handle("agent:connect", (_event, agent_id: string) => agent_controller.connect_agent(agent_id));
ipcMain.handle("chat:list-sessions", (_event, agent_id: string) => agent_controller.list_sessions(agent_id));
ipcMain.handle("chat:create-session", (_event, agent_id: string) => agent_controller.create_session(agent_id));
ipcMain.handle("chat:list-messages", (_event, agent_id: string, session_id: string) => agent_controller.list_messages(agent_id, session_id));
ipcMain.handle("chat:send", (_event, agent_id: string, session_id: string, text: string) => agent_controller.send_message(agent_id, session_id, text));

app.whenReady().then(() => {
  configure_development_icon();
  create_window();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) create_window(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void agent_controller.dispose().finally(() => app.quit());
});
