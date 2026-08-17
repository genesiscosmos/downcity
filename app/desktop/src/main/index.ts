/** Downcity Desktop Electron 主进程入口。 */
import { app, BrowserWindow, dialog, ipcMain, nativeImage, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentController } from "@/agent/AgentController.js";
import { create_desktop_local_data } from "@/agent/DesktopLocalData.js";
import { DesktopSettingsController } from "@/settings/DesktopSettingsController.js";
import { DesktopUserController } from "@/user/DesktopUserController.js";
import { PluginController } from "@/plugin/PluginController.js";
import { read_city_host_state, request_city_host_shutdown } from "@downcity/city";
import type {
  DesktopChatInput,
  DesktopChatMutationEvent,
  DesktopChatRuntimeEvent,
} from "../common/types/DesktopApi.js";
import type { RespondSessionInteractionInput, SessionApprovalMode } from "@downcity/agent";

const current_directory = path.dirname(fileURLToPath(import.meta.url));
const development_macos_icon_path = path.join(current_directory, "../../build/icon.iconset/icon_512x512@2x.png");
const development_window_icon_path = path.join(current_directory, "../../build/icons/512x512.png");
let agent_controller: AgentController | undefined;
const local_data = create_desktop_local_data();
const settings_controller = new DesktopSettingsController(local_data);
const plugin_controller = new PluginController(local_data);
let user_controller: DesktopUserController;
let quitting = false;

/** 向全部仍存活的 Renderer 广播一条安全事件。 */
function broadcast(channel: string, payload: DesktopChatMutationEvent | DesktopChatRuntimeEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) window.webContents.send(channel, payload);
  }
}

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

/** 返回已创建的 Desktop Agent 控制器。 */
function require_agent_controller(): AgentController {
  if (!agent_controller) throw new Error("Desktop Agent controller is not ready");
  return agent_controller;
}

ipcMain.handle("agent:list", () => require_agent_controller().list_agents());
ipcMain.handle("agent:get", (_event, agent_id: string) => require_agent_controller().get_agent(agent_id));
ipcMain.handle("agent:create", (_event, agent_id: string, model_id: string) => require_agent_controller().create_agent(agent_id, model_id));
ipcMain.handle("agent:update", (_event, agent_id: string, input: import("../common/types/DesktopApi.js").DesktopUpdateAgentInput) => require_agent_controller().update_agent(agent_id, input));
ipcMain.handle("workspace:list", () => require_agent_controller().list_workspaces());
ipcMain.handle("workspace:create", (_event, workspace_path: string, name: string) => require_agent_controller().create_workspace(workspace_path, name));
ipcMain.handle("agent:connect", (_event, agent_id: string, workspace_id: string) => require_agent_controller().connect_agent(agent_id, workspace_id));
ipcMain.handle("chat:list-sessions", (_event, agent_id: string, workspace_id: string) => require_agent_controller().list_sessions(agent_id, workspace_id));
ipcMain.handle("chat:list-models", () => require_agent_controller().list_models());
ipcMain.handle("plugin:list", () => plugin_controller.list());
ipcMain.handle("plugin:get", (_event, plugin_id: string) => plugin_controller.get(plugin_id));
ipcMain.handle("plugin:save-profile", (_event, plugin_id: string, input: import("../common/types/DesktopApi.js").DesktopSavePluginProfileInput) => plugin_controller.save_profile(plugin_id, input));
ipcMain.handle("plugin:remove-profile", (_event, plugin_id: string, profile_id: string) => plugin_controller.remove_profile(plugin_id, profile_id));
ipcMain.handle("chat:create-session", (_event, agent_id: string, workspace_id: string) => require_agent_controller().create_session(agent_id, workspace_id));
ipcMain.handle("chat:rename-session", (_event, agent_id: string, workspace_id: string, session_id: string, title: string) => require_agent_controller().rename_session(agent_id, workspace_id, session_id, title));
ipcMain.handle("chat:archive-session", (_event, agent_id: string, workspace_id: string, session_id: string) => require_agent_controller().archive_session(agent_id, workspace_id, session_id));
ipcMain.handle("chat:remove-session", (_event, agent_id: string, workspace_id: string, session_id: string) => require_agent_controller().remove_session(agent_id, workspace_id, session_id));
ipcMain.handle("chat:list-archived-sessions", (_event, agent_id: string, workspace_id: string) => require_agent_controller().list_archived_sessions(agent_id, workspace_id));
ipcMain.handle("chat:get-snapshot", (_event, agent_id: string, workspace_id: string, session_id: string) => require_agent_controller().get_chat_snapshot(agent_id, workspace_id, session_id));
ipcMain.handle("chat:get-history", (_event, agent_id: string, workspace_id: string, session_id: string, before_sequence: number) => require_agent_controller().get_chat_history(agent_id, workspace_id, session_id, before_sequence));
ipcMain.handle("chat:send", (_event, agent_id: string, workspace_id: string, session_id: string, input: DesktopChatInput) => require_agent_controller().send_message(agent_id, workspace_id, session_id, input));
ipcMain.handle("chat:stop", (_event, agent_id: string, workspace_id: string, session_id: string) => require_agent_controller().stop_session(agent_id, workspace_id, session_id));
ipcMain.handle("chat:respond", (_event, agent_id: string, workspace_id: string, session_id: string, input: RespondSessionInteractionInput) => require_agent_controller().respond_interaction(agent_id, workspace_id, session_id, input));
ipcMain.handle("chat:get-runtime", (_event, agent_id: string, workspace_id: string, session_id: string) => require_agent_controller().get_runtime(agent_id, workspace_id, session_id));
ipcMain.handle("chat:get-configuration", (_event, agent_id: string, workspace_id: string, session_id: string) => require_agent_controller().get_configuration(agent_id, workspace_id, session_id));
ipcMain.handle("chat:set-model", (_event, agent_id: string, workspace_id: string, session_id: string, model_id: string) => require_agent_controller().set_model(agent_id, workspace_id, session_id, model_id));
ipcMain.handle("chat:set-approval-mode", (_event, agent_id: string, workspace_id: string, session_id: string, approval_mode: SessionApprovalMode) => require_agent_controller().set_approval_mode(agent_id, workspace_id, session_id, approval_mode));
ipcMain.handle("settings:get", () => settings_controller.get());
ipcMain.handle("settings:update", async (_event, patch) => {
  const settings = settings_controller.update(patch);
  await apply_proxy_settings(settings.proxy_enabled, settings.proxy_url);
  return settings;
});
ipcMain.handle("user:current", () => user_controller.current());
ipcMain.handle("user:login", (_event, federation_url: string, user_token: string) => user_controller.login(federation_url, user_token));
ipcMain.handle("user:list-accounts", () => user_controller.list_accounts());
ipcMain.handle("user:switch-account", (_event, account_id: string) => user_controller.switch_account(account_id));
ipcMain.handle("user:remove-account", (_event, account_id: string) => user_controller.remove_account(account_id));
ipcMain.handle("user:get-resources", () => user_controller.get_resources());
ipcMain.handle("user:logout", () => user_controller.logout());
ipcMain.handle("dialog:open-directory", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

async function prepare_city_host(): Promise<void> {
  const existing_host = await read_city_host_state();
  if (!existing_host) return;
  const result = await dialog.showMessageBox({
    type: "question",
    buttons: ["关闭并继续", "取消"],
    defaultId: 1,
    cancelId: 1,
    title: "Downcity City 已在运行",
    message: `${existing_host.owner === "cli" ? "CLI" : "Desktop"} 正在运行 City（PID ${existing_host.pid}）。`,
    detail: "是否关闭当前 City 并由 Desktop 接管？",
  });
  if (result.response !== 0) throw new Error("Desktop City start cancelled");
  await request_city_host_shutdown(existing_host);
}

/** 把 Desktop 网络代理设置应用到 Electron 默认 Session。 */
async function apply_proxy_settings(proxy_enabled: boolean, proxy_url: string): Promise<void> {
  const proxy_rules = proxy_enabled ? String(proxy_url || "").trim() : "";
  if (proxy_enabled && !proxy_rules) throw new Error("启用网络代理前需要填写代理地址");
  await session.defaultSession.setProxy({
    proxyRules: proxy_rules,
    proxyBypassRules: "<-loopback>",
  });
}

app.whenReady().then(async () => {
  const current_settings = settings_controller.get();
  await apply_proxy_settings(current_settings.proxy_enabled, current_settings.proxy_url);
  await prepare_city_host();
  const next_agent_controller = new AgentController(local_data, {
    mutation: (event) => broadcast("chat:mutation", event),
    runtime: (event) => broadcast("chat:runtime", event),
  });
  agent_controller = next_agent_controller;
  user_controller = new DesktopUserController(local_data, () => next_agent_controller.has_active_sessions());
  await next_agent_controller.ready();
  configure_development_icon();
  create_window();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) create_window(); });
}).catch((error: unknown) => {
  if (error instanceof Error && error.message !== "Desktop City start cancelled") {
    console.error("Downcity Desktop start failed", error);
  }
  app.quit();
});
process.on("SIGTERM", () => app.quit());
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void (agent_controller?.dispose() ?? Promise.resolve()).finally(() => {
    local_data.database.close();
    app.quit();
  });
});
