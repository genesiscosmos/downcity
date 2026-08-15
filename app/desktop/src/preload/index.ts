/** Downcity Desktop 的最小安全 IPC 桥接。 */
import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAgentSummary, DesktopApi } from "../common/types/DesktopApi.js";

const desktop_api: DesktopApi = {
  agent: {
    list: (): Promise<DesktopAgentSummary[]> => ipcRenderer.invoke("agent:list"),
    create: (agent_id, workspace_path, model_id) => ipcRenderer.invoke("agent:create", agent_id, workspace_path, model_id),
    connect: (agent_id) => ipcRenderer.invoke("agent:connect", agent_id),
  },
  workspace: {
    list: () => ipcRenderer.invoke("workspace:list"),
    create: (workspace_path, name) => ipcRenderer.invoke("workspace:create", workspace_path, name),
  },
  plugin: {
    list: () => ipcRenderer.invoke("plugin:list"),
  },
  dialog: {
    open_directory: () => ipcRenderer.invoke("dialog:open-directory"),
  },
  chat: {
    list_models: () => ipcRenderer.invoke("chat:list-models"),
    list_sessions: (agent_id) => ipcRenderer.invoke("chat:list-sessions", agent_id),
    create_session: (agent_id) => ipcRenderer.invoke("chat:create-session", agent_id),
    rename_session: (agent_id, session_id, title) => ipcRenderer.invoke("chat:rename-session", agent_id, session_id, title),
    archive_session: (agent_id, session_id) => ipcRenderer.invoke("chat:archive-session", agent_id, session_id),
    remove_session: (agent_id, session_id) => ipcRenderer.invoke("chat:remove-session", agent_id, session_id),
    list_archived_sessions: (agent_id) => ipcRenderer.invoke("chat:list-archived-sessions", agent_id),
    get_snapshot: (agent_id, session_id) => ipcRenderer.invoke("chat:get-snapshot", agent_id, session_id),
    get_history: (agent_id, session_id, before_sequence) => ipcRenderer.invoke("chat:get-history", agent_id, session_id, before_sequence),
    send: (agent_id, session_id, input) => ipcRenderer.invoke("chat:send", agent_id, session_id, input),
    stop: (agent_id, session_id) => ipcRenderer.invoke("chat:stop", agent_id, session_id),
    respond: (agent_id, session_id, input) => ipcRenderer.invoke("chat:respond", agent_id, session_id, input),
    get_runtime: (agent_id, session_id) => ipcRenderer.invoke("chat:get-runtime", agent_id, session_id),
    get_configuration: (agent_id, session_id) => ipcRenderer.invoke("chat:get-configuration", agent_id, session_id),
    set_model: (agent_id, session_id, model_id) => ipcRenderer.invoke("chat:set-model", agent_id, session_id, model_id),
    set_approval_mode: (agent_id, session_id, approval_mode) => ipcRenderer.invoke("chat:set-approval-mode", agent_id, session_id, approval_mode),
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
    login: (federation_url, user_token) => ipcRenderer.invoke("user:login", federation_url, user_token),
    list_accounts: () => ipcRenderer.invoke("user:list-accounts"),
    switch_account: (account_id) => ipcRenderer.invoke("user:switch-account", account_id),
    remove_account: (account_id) => ipcRenderer.invoke("user:remove-account", account_id),
    get_resources: () => ipcRenderer.invoke("user:get-resources"),
    logout: () => ipcRenderer.invoke("user:logout"),
  },
};

contextBridge.exposeInMainWorld("downcity", desktop_api);
