/** Downcity Desktop 的最小安全 IPC 桥接。 */
import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAgentSummary, DesktopApi } from "../common/types/DesktopApi.js";

const desktop_api: DesktopApi = {
  agent: {
    list: (): Promise<DesktopAgentSummary[]> => ipcRenderer.invoke("agent:list"),
    get: (agent_id) => ipcRenderer.invoke("agent:get", agent_id),
    create: (agent_id, model_id) => ipcRenderer.invoke("agent:create", agent_id, model_id),
    update: (agent_id, input) => ipcRenderer.invoke("agent:update", agent_id, input),
    choose_avatar: (agent_id) => ipcRenderer.invoke("agent:choose-avatar", agent_id),
    remove_avatar: (agent_id) => ipcRenderer.invoke("agent:remove-avatar", agent_id),
    generate_avatar: (agent_id) => ipcRenderer.invoke("agent:generate-avatar", agent_id),
    connect: (agent_id, workspace_id) => ipcRenderer.invoke("agent:connect", agent_id, workspace_id),
  },
  workspace: {
    list: () => ipcRenderer.invoke("workspace:list"),
    create: (workspace_path, name) => ipcRenderer.invoke("workspace:create", workspace_path, name),
  },
  plugin: {
    list: () => ipcRenderer.invoke("plugin:list"),
    get: (plugin_id) => ipcRenderer.invoke("plugin:get", plugin_id),
    save_profile: (plugin_id, input) => ipcRenderer.invoke("plugin:save-profile", plugin_id, input),
    remove_profile: (plugin_id, profile_id) => ipcRenderer.invoke("plugin:remove-profile", plugin_id, profile_id),
  },
  dialog: {
    open_directory: () => ipcRenderer.invoke("dialog:open-directory"),
  },
  chat: {
    list_models: () => ipcRenderer.invoke("chat:list-models"),
    list_sessions: (agent_id, workspace_id) => ipcRenderer.invoke("chat:list-sessions", agent_id, workspace_id),
    create_session: (agent_id, workspace_id) => ipcRenderer.invoke("chat:create-session", agent_id, workspace_id),
    fork_session: (...args) => ipcRenderer.invoke("chat:fork-session", ...args),
    rewrite_session_message: (...args) => ipcRenderer.invoke("chat:rewrite-session-message", ...args),
    rename_session: (...args) => ipcRenderer.invoke("chat:rename-session", ...args),
    archive_session: (...args) => ipcRenderer.invoke("chat:archive-session", ...args),
    remove_session: (...args) => ipcRenderer.invoke("chat:remove-session", ...args),
    list_archived_sessions: (...args) => ipcRenderer.invoke("chat:list-archived-sessions", ...args),
    get_snapshot: (...args) => ipcRenderer.invoke("chat:get-snapshot", ...args),
    get_history: (...args) => ipcRenderer.invoke("chat:get-history", ...args),
    send: (...args) => ipcRenderer.invoke("chat:send", ...args),
    compact_session: (...args) => ipcRenderer.invoke("chat:compact-session", ...args),
    stop: (...args) => ipcRenderer.invoke("chat:stop", ...args),
    respond: (...args) => ipcRenderer.invoke("chat:respond", ...args),
    get_runtime: (...args) => ipcRenderer.invoke("chat:get-runtime", ...args),
    get_configuration: (...args) => ipcRenderer.invoke("chat:get-configuration", ...args),
    set_model: (...args) => ipcRenderer.invoke("chat:set-model", ...args),
    set_approval_mode: (...args) => ipcRenderer.invoke("chat:set-approval-mode", ...args),
    on_mutation: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) => callback(value);
      ipcRenderer.on("chat:mutation", handler);
      return () => ipcRenderer.removeListener("chat:mutation", handler);
    },
    on_runtime: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) => callback(value);
      ipcRenderer.on("chat:runtime", handler);
      return () => ipcRenderer.removeListener("chat:runtime", handler);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (patch) => ipcRenderer.invoke("settings:update", patch),
  },
  user: {
    current: () => ipcRenderer.invoke("user:current"),
    list_login_providers: (federation_url, force_refresh) => ipcRenderer.invoke("user:list-login-providers", federation_url, force_refresh),
    start_login: (input) => ipcRenderer.invoke("user:start-login", input),
    get_login_result: (login_id) => ipcRenderer.invoke("user:get-login-result", login_id),
    cancel_login: (login_id) => ipcRenderer.invoke("user:cancel-login", login_id),
    list_accounts: () => ipcRenderer.invoke("user:list-accounts"),
    switch_account: (account_id) => ipcRenderer.invoke("user:switch-account", account_id),
    remove_account: (account_id) => ipcRenderer.invoke("user:remove-account", account_id),
    get_resources: () => ipcRenderer.invoke("user:get-resources"),
    logout: () => ipcRenderer.invoke("user:logout"),
  },
};

contextBridge.exposeInMainWorld("downcity", desktop_api);
