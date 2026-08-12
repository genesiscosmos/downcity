/** Downcity Desktop Electron 主进程入口。 */
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentController } from "@/agent/AgentController.js";

const current_directory = path.dirname(fileURLToPath(import.meta.url));
const agent_controller = new AgentController();
let quitting = false;

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
ipcMain.handle("agent:connect", (_event, agent_id: string, workspace_id: string) => agent_controller.connect_agent(agent_id, workspace_id));
ipcMain.handle("chat:list-sessions", (_event, agent_id: string) => agent_controller.list_sessions(agent_id));
ipcMain.handle("chat:create-session", (_event, agent_id: string) => agent_controller.create_session(agent_id));
ipcMain.handle("chat:list-messages", (_event, agent_id: string, session_id: string) => agent_controller.list_messages(agent_id, session_id));
ipcMain.handle("chat:send", (_event, agent_id: string, session_id: string, text: string) => agent_controller.send_message(agent_id, session_id, text));

app.whenReady().then(() => { create_window(); app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) create_window(); }); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void agent_controller.dispose().finally(() => app.quit());
});
