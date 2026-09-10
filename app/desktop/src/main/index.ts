/** Downcity Desktop Electron 主进程入口。 */
import { app, BrowserWindow, dialog, ipcMain, nativeImage, session, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentController } from "@/agent/AgentController.js";
import { create_desktop_local_data } from "@/agent/DesktopLocalData.js";
import { DesktopSettingsController } from "@/settings/DesktopSettingsController.js";
import { DesktopUserController } from "@/user/DesktopUserController.js";
import { PluginController } from "@/plugin/PluginController.js";
import {
  register_plugin_renderer_protocol,
  register_plugin_renderer_scheme,
} from "@/plugin/PluginRendererProtocol.js";
import { DesktopGlobalEnvController } from "@/settings/DesktopGlobalEnvController.js";
import { DesktopAppBadge } from "@/notification/DesktopAppBadge.js";
import { DesktopNotificationCenter } from "@/notification/DesktopNotificationCenter.js";
import { NotificationStore } from "@/notification/NotificationStore.js";
import { read_city_host_state, request_city_host_shutdown } from "@downcity/city";
import type {
  DesktopChatMutationEvent,
  DesktopChatRuntimeEvent,
  DesktopLoginStartInput,
  DesktopGroupEvent,
} from "../common/types/DesktopApi.js";
import type { JSONContent } from "@tiptap/core";
import type { DesktopNotificationState, DesktopNotificationViewState } from "../common/types/DesktopNotification.js";
import type { RespondSessionInteractionInput, SessionApprovalMode } from "@downcity/agent";

const current_directory = path.dirname(fileURLToPath(import.meta.url));
const development_macos_icon_path = path.join(current_directory, "../../build/icon.iconset/icon_512x512@2x.png");
const development_window_icon_path = path.join(current_directory, "../../build/icons/512x512.png");
let agent_controller: AgentController | undefined;
let notification_center: DesktopNotificationCenter | undefined;
const local_data = create_desktop_local_data();
const settings_controller = new DesktopSettingsController(local_data);
const global_env_controller = new DesktopGlobalEnvController(local_data);
let plugin_controller: PluginController | undefined;
let user_controller: DesktopUserController;
let quitting = false;

register_plugin_renderer_scheme();

/** 向全部仍存活的 Renderer 广播一条安全事件。 */
function broadcast(channel: string, payload: DesktopChatMutationEvent | DesktopChatRuntimeEvent | DesktopGroupEvent | DesktopNotificationState): void {
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
  const view_id = window.webContents.id;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.once("ready-to-show", () => window.show());
  // 关键点（中文）：窗口失焦由主进程同步撤销可见目标，避免 Renderer IPC 到达前误判为已读。
  window.on("blur", () => notification_center?.set_view_state(view_id, { visible: false }));
  window.webContents.once("destroyed", () => notification_center?.remove_view(view_id));
  return window;
}

/** 返回已创建的 Desktop Agent 控制器。 */
function require_agent_controller(): AgentController {
  if (!agent_controller) throw new Error("Desktop Agent controller is not ready");
  return agent_controller;
}

/** 返回拥有通知状态和生产者生命周期的 Desktop Notification 门面。 */
function require_notification_center(): DesktopNotificationCenter {
  if (!notification_center) throw new Error("Desktop Notification center is not ready");
  return notification_center;
}

/** 返回 City ready 后创建的 Plugin catalog 门面。 */
function require_plugin_controller(): PluginController {
  if (!plugin_controller) throw new Error("Desktop Plugin controller is not ready");
  return plugin_controller;
}

ipcMain.handle("system:open-external-url", async (_event, value: string) => {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("仅支持使用浏览器打开 HTTP(S) 地址");
  await shell.openExternal(url.toString());
});
ipcMain.handle("system:open-local-file", async (_event, value: string) => {
  if (!path.isAbsolute(value)) throw new Error("本地文件必须使用绝对路径");
  const error = await shell.openPath(path.normalize(value));
  if (error) throw new Error(error);
});
ipcMain.handle("system:open-in-vscode", async (_event, value: string) => {
  if (!path.isAbsolute(value)) throw new Error("VS Code 只能打开绝对本地路径");
  const normalized = path.normalize(value).replace(/\\/g, "/");
  const encoded_path = normalized.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  await shell.openExternal(`vscode://file/${encoded_path}`);
});
ipcMain.handle("notification:get-state", () => require_notification_center().get_state());
ipcMain.handle("notification:set-view-state", (event, state: DesktopNotificationViewState) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  require_notification_center().set_view_state(event.sender.id, {
    ...state,
    visible: Boolean(state?.visible && window?.isVisible() && window.isFocused()),
  });
});

ipcMain.handle("agent:list", () => require_agent_controller().list_agents());
ipcMain.handle("agent:get", (_event, agent_id: string) => require_agent_controller().get_agent(agent_id));
ipcMain.handle("agent:create", (_event, input: import("../common/types/DesktopApi.js").DesktopCreateAgentInput) => require_agent_controller().create_agent(input));
ipcMain.handle("agent:generate-draft", (_event, input: import("../common/types/DesktopApi.js").DesktopGenerateAgentDraftInput) => require_agent_controller().generate_agent_draft(input));
ipcMain.handle("agent:update", (_event, agent_id: string, input: import("../common/types/DesktopApi.js").DesktopUpdateAgentInput) => require_agent_controller().update_agent(agent_id, input));
ipcMain.handle("agent:remove", async (_event, agent_id: string) => {
  const removed = await require_agent_controller().remove_agent(agent_id);
  if (removed) require_notification_center().handle_agent_removed(agent_id);
  return removed;
});
ipcMain.handle("agent:choose-avatar", async (_event, agent_id: string) => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Agent Avatar", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return require_agent_controller().set_avatar(agent_id, result.filePaths[0]);
});
ipcMain.handle("agent:remove-avatar", (_event, agent_id: string) => require_agent_controller().remove_avatar(agent_id));
ipcMain.handle("agent:generate-avatar", (_event, agent_id: string) => require_agent_controller().generate_avatar(agent_id));
ipcMain.handle("workspace:list", () => require_agent_controller().list_workspaces());
ipcMain.handle("workspace:get-default", () => require_agent_controller().get_default_workspace());
ipcMain.handle("workspace:create", (_event, input: import("../common/types/DesktopApi.js").DesktopCreateWorkspaceInput) => require_agent_controller().create_workspace(input));
ipcMain.handle("workspace:update-name", (_event, workspace_id: string, name: string) => require_agent_controller().update_workspace_name(workspace_id, name));
ipcMain.handle("workspace:remove", (_event, workspace_id: string) => require_agent_controller().remove_workspace(workspace_id));
ipcMain.handle("workspace:write-readme", (_event, workspace_id: string, content: string) => require_agent_controller().write_workspace_readme(workspace_id, content));
ipcMain.handle("workspace:list-entries", (_event, workspace_id: string, relative_path?: string) => require_agent_controller().list_workspace_entries(workspace_id, relative_path));
ipcMain.handle("workspace:read-text-file", (_event, workspace_id: string, relative_path: string) => require_agent_controller().read_workspace_text_file(workspace_id, relative_path));
ipcMain.handle("agent:connect", (_event, agent_id: string, workspace_id: string) => require_agent_controller().connect_agent(agent_id, workspace_id));
ipcMain.handle("group:list", () => require_agent_controller().list_groups());
ipcMain.handle("group:create", (_event, input: import("../common/types/DesktopApi.js").DesktopCreateGroupInput) => require_agent_controller().create_group(input));
ipcMain.handle("group:generate-draft", (_event, input: import("../common/types/DesktopApi.js").DesktopGenerateGroupDraftInput) => require_agent_controller().generate_group_draft(input));
ipcMain.handle("group:update", (_event, group_id: string, input: import("../common/types/DesktopApi.js").DesktopUpdateGroupInput) => require_agent_controller().update_group(group_id, input));
ipcMain.handle("group:remove", (_event, group_id: string) => require_agent_controller().remove_group(group_id));
ipcMain.handle("group:open", (_event, group_id: string, session_id?: string) => require_agent_controller().open_group(group_id, session_id));
ipcMain.handle("group:list-sessions", (_event, group_id: string) => require_agent_controller().list_group_sessions(group_id));
ipcMain.handle("group:create-session", (_event, group_id: string, workspace_id?: string) => require_agent_controller().create_group_session(group_id, workspace_id));
ipcMain.handle("group:rename-session", (_event, group_id: string, session_id: string, title: string) => require_agent_controller().rename_group_session(group_id, session_id, title));
ipcMain.handle("group:list-messages", (_event, group_id: string, session_id?: string) => require_agent_controller().list_group_messages(group_id, session_id));
ipcMain.handle("group:send", (_event, group_id: string, session_id: string | undefined, input: import("../common/types/DesktopApi.js").DesktopGroupSendInput) => require_agent_controller().send_group_message(group_id, session_id, input));
ipcMain.handle("group:stop", (_event, group_id: string, session_id?: string) => require_agent_controller().stop_group(group_id, session_id));
ipcMain.handle("group:respond-interaction", (_event, group_id: string, session_id: string, input: RespondSessionInteractionInput) => require_agent_controller().respond_group_interaction(group_id, session_id, input));
ipcMain.handle("group:remove-session", (_event, group_id: string, session_id: string) => require_agent_controller().remove_group_session(group_id, session_id));
ipcMain.handle("chat:list-sessions", (_event, agent_id: string, workspace_id?: string) => require_agent_controller().list_sessions(agent_id, workspace_id));
ipcMain.handle("chat:rebind-session-workspace", (_event, agent_id: string, session_id: string, workspace_id: string) => require_agent_controller().rebind_session_workspace(agent_id, session_id, workspace_id));
ipcMain.handle("chat:list-models", () => require_agent_controller().list_models());
ipcMain.handle("chat:list-workspace-files", (_event, workspace_id: string) => require_agent_controller().list_workspace_files(workspace_id));
ipcMain.handle("chat:read-workspace-file", (_event, workspace_id: string, relative_path: string) => require_agent_controller().read_workspace_file(workspace_id, relative_path));
ipcMain.handle("plugin:list", () => require_plugin_controller().list());
ipcMain.handle("plugin:get", (_event, plugin_id: string) => require_plugin_controller().get(plugin_id));
ipcMain.handle("plugin:invoke", (_event, plugin_id: string, input: import("../common/types/DesktopApi.js").DesktopInvokePluginActionInput) => require_plugin_controller().invoke(plugin_id, input));
ipcMain.handle("chat:create-session", (_event, agent_id: string, workspace_id: string, configuration: import("../common/types/DesktopApi.js").DesktopSessionConfiguration) => require_agent_controller().create_session(agent_id, workspace_id, configuration));
ipcMain.handle("chat:fork-session", (_event, agent_id: string, workspace_id: string, session_id: string, message_id: string) => require_agent_controller().fork_session(agent_id, workspace_id, session_id, message_id));
ipcMain.handle("chat:rewrite-session-message", (_event, agent_id: string, workspace_id: string, session_id: string, input: import("../common/types/DesktopApi.js").DesktopChatRewriteInput) => require_agent_controller().rewrite_session_message(agent_id, workspace_id, session_id, input));
ipcMain.handle("chat:rename-session", (_event, agent_id: string, workspace_id: string, session_id: string, title: string) => require_agent_controller().rename_session(agent_id, workspace_id, session_id, title));
ipcMain.handle("chat:archive-session", async (_event, agent_id: string, workspace_id: string, session_id: string) => {
  await require_agent_controller().archive_session(agent_id, workspace_id, session_id);
  require_notification_center().handle_agent_session_closed(agent_id, workspace_id, session_id);
});
ipcMain.handle("chat:remove-session", async (_event, agent_id: string, workspace_id: string, session_id: string) => {
  const removed = await require_agent_controller().remove_session(agent_id, workspace_id, session_id);
  require_notification_center().handle_agent_session_closed(agent_id, workspace_id, session_id);
  return removed;
});
ipcMain.handle("chat:list-archived-sessions", (_event, agent_id: string, workspace_id?: string) => require_agent_controller().list_archived_sessions(agent_id, workspace_id));
ipcMain.handle("chat:get-snapshot", (_event, agent_id: string, workspace_id: string, session_id: string) => require_agent_controller().get_chat_snapshot(agent_id, workspace_id, session_id));
ipcMain.handle("chat:get-history", (_event, agent_id: string, workspace_id: string, session_id: string, before_sequence: number) => require_agent_controller().get_chat_history(agent_id, workspace_id, session_id, before_sequence));
ipcMain.handle("chat:send", (_event, agent_id: string, workspace_id: string, session_id: string, input: JSONContent) => require_agent_controller().send_message(agent_id, workspace_id, session_id, input));
ipcMain.handle("chat:stop", (_event, agent_id: string, workspace_id: string, session_id: string) => require_agent_controller().stop_session(agent_id, workspace_id, session_id));
ipcMain.handle("chat:respond", (_event, agent_id: string, workspace_id: string, session_id: string, input: RespondSessionInteractionInput) => require_agent_controller().respond_interaction(agent_id, workspace_id, session_id, input));
ipcMain.handle("chat:get-runtime", (_event, agent_id: string, workspace_id: string, session_id: string) => require_agent_controller().get_runtime(agent_id, workspace_id, session_id));
ipcMain.handle("chat:get-configuration", (_event, agent_id: string, workspace_id: string, session_id: string) => require_agent_controller().get_configuration(agent_id, workspace_id, session_id));
ipcMain.handle("chat:set-model", (_event, agent_id: string, workspace_id: string, session_id: string, model_id: string) => require_agent_controller().set_model(agent_id, workspace_id, session_id, model_id));
ipcMain.handle("chat:set-reasoning-effort", (_event, agent_id: string, workspace_id: string, session_id: string, reasoning_effort?: string) => require_agent_controller().set_reasoning_effort(agent_id, workspace_id, session_id, reasoning_effort));
ipcMain.handle("chat:set-approval-mode", (_event, agent_id: string, workspace_id: string, session_id: string, approval_mode: SessionApprovalMode) => require_agent_controller().set_approval_mode(agent_id, workspace_id, session_id, approval_mode));
ipcMain.handle("settings:get", () => settings_controller.get());
ipcMain.handle("settings:update", async (_event, patch) => {
  const settings = settings_controller.update(patch);
  await apply_proxy_settings(settings.proxy_enabled, settings.proxy_url);
  return settings;
});
ipcMain.handle("settings:env-list", () => global_env_controller.list());
ipcMain.handle("settings:env-update", async (_event, raw: unknown) => {
  const result = await global_env_controller.update(raw);
  await agent_controller?.reload_global_env();
  return result;
});
ipcMain.handle("user:current", () => user_controller.current());
ipcMain.handle("user:list-login-providers", (_event, federation_url: string, force_refresh?: boolean) => user_controller.list_login_providers(federation_url, force_refresh));
ipcMain.handle("user:start-login", async (_event, input: DesktopLoginStartInput) => {
  const result = await user_controller.start_login(input);
  if (result.status === "redirect_required") {
    try {
      if (!result.url) throw new Error("Federation 未返回授权地址");
      await shell.openExternal(normalize_external_login_url(result.url));
    } catch (reason) {
      user_controller.cancel_login(result.login_id);
      throw reason;
    }
  }
  return result;
});

function normalize_external_login_url(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Federation 返回了不受支持的授权地址");
  return url.toString();
}
ipcMain.handle("user:get-login-result", (_event, login_id: string) => user_controller.get_login_result(login_id));
ipcMain.handle("user:cancel-login", (_event, login_id: string) => user_controller.cancel_login(login_id));
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
    // 本地回环服务（包括 Electron 开发环境的 Vite Server）始终直连，不经过用户代理。
    proxyBypassRules: "localhost;127.0.0.1;[::1]",
  });
}

app.whenReady().then(async () => {
  register_plugin_renderer_protocol(local_data);
  const current_settings = settings_controller.get();
  await apply_proxy_settings(current_settings.proxy_enabled, current_settings.proxy_url);
  await prepare_city_host();
  const next_notification_center = new DesktopNotificationCenter(
    new NotificationStore(local_data.settings),
    new DesktopAppBadge(app),
    { state_changed: (state) => broadcast("notification:state", state) },
  );
  notification_center = next_notification_center;
  const next_agent_controller = new AgentController(local_data, {
    mutation: (event) => broadcast("chat:mutation", event),
    runtime: (event) => {
      next_notification_center.handle_session_runtime(event.runtime);
      broadcast("chat:runtime", event);
    },
    group_event: (event) => broadcast("group:event", event),
    plugin_notification: async (plugin_id, agent_id, input) => next_notification_center.publish_agent_plugin_notification(plugin_id, agent_id, input),
    plugin_notification_dismiss: async (plugin_id, topic_key) => next_notification_center.dismiss_plugin_notification(plugin_id, topic_key),
    plugin_host_notification: async (plugin_id, input) => next_notification_center.publish_plugin_notification(plugin_id, input),
    plugin_host_notification_dismiss: async (plugin_id, topic_key) => next_notification_center.dismiss_plugin_notification(plugin_id, topic_key),
  });
  agent_controller = next_agent_controller;
  plugin_controller = new PluginController(
    local_data,
    async (plugin_id, action_id, input) =>
      await next_agent_controller.invoke_plugin_main(plugin_id, action_id, input),
    async (plugin_id, action_id, input) =>
      await next_agent_controller.invoke_plugin_config(
        plugin_id,
        action_id,
        input,
      ),
    () => next_agent_controller.list_plugin_states(),
  );
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
  void Promise.allSettled([
    agent_controller?.dispose() ?? Promise.resolve(),
  ]).finally(() => {
    local_data.database.close();
    app.quit();
  });
});
