/** Downcity Desktop 的最小安全 IPC 桥接。 */
import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAgentSummary, DesktopApi } from "../common/types/DesktopApi.js";

const desktop_api: DesktopApi = {
  system: {
    open_external_url: (url) => ipcRenderer.invoke("system:open-external-url", url),
    open_local_file: (file_path) => ipcRenderer.invoke("system:open-local-file", file_path),
  },
  notification: {
    get_state: () => ipcRenderer.invoke("notification:get-state"),
    set_view_state: (state) => ipcRenderer.invoke("notification:set-view-state", state),
    subscribe: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) => callback(value);
      ipcRenderer.on("notification:state", handler);
      return () => ipcRenderer.removeListener("notification:state", handler);
    },
  },
  agent: {
    list: (): Promise<DesktopAgentSummary[]> => ipcRenderer.invoke("agent:list"),
    get: (agent_id) => ipcRenderer.invoke("agent:get", agent_id),
    create: (input) => ipcRenderer.invoke("agent:create", input),
    generate_draft: (input) => ipcRenderer.invoke("agent:generate-draft", input),
    update: (agent_id, input) => ipcRenderer.invoke("agent:update", agent_id, input),
    remove: (agent_id) => ipcRenderer.invoke("agent:remove", agent_id),
    choose_avatar: (agent_id) => ipcRenderer.invoke("agent:choose-avatar", agent_id),
    remove_avatar: (agent_id) => ipcRenderer.invoke("agent:remove-avatar", agent_id),
    generate_avatar: (agent_id) => ipcRenderer.invoke("agent:generate-avatar", agent_id),
    connect: (agent_id, workspace_id) => ipcRenderer.invoke("agent:connect", agent_id, workspace_id),
  },
  workspace: {
    list: () => ipcRenderer.invoke("workspace:list"),
    get_default: () => ipcRenderer.invoke("workspace:get-default"),
    create: (input) => ipcRenderer.invoke("workspace:create", input),
    update_name: (workspace_id, name) => ipcRenderer.invoke("workspace:update-name", workspace_id, name),
    remove: (workspace_id) => ipcRenderer.invoke("workspace:remove", workspace_id),
    write_readme: (workspace_id, content) => ipcRenderer.invoke("workspace:write-readme", workspace_id, content),
    list_entries: (workspace_id, relative_path) => ipcRenderer.invoke("workspace:list-entries", workspace_id, relative_path),
    read_text_file: (workspace_id, relative_path) => ipcRenderer.invoke("workspace:read-text-file", workspace_id, relative_path),
  },
  plugin: {
    list: () => ipcRenderer.invoke("plugin:list"),
    get: (plugin_id) => ipcRenderer.invoke("plugin:get", plugin_id),
    invoke: (plugin_id, input) => ipcRenderer.invoke("plugin:invoke", plugin_id, input),
  },
  dialog: {
    open_directory: () => ipcRenderer.invoke("dialog:open-directory"),
  },
  chat: {
    list_workspace_files: (workspace_id) => ipcRenderer.invoke("chat:list-workspace-files", workspace_id),
    read_workspace_file: (workspace_id, relative_path) => ipcRenderer.invoke("chat:read-workspace-file", workspace_id, relative_path),
    list_models: () => ipcRenderer.invoke("chat:list-models"),
    list_sessions: (agent_id, workspace_id) => ipcRenderer.invoke("chat:list-sessions", agent_id, workspace_id),
    rebind_session_workspace: (agent_id, session_id, workspace_id) => ipcRenderer.invoke("chat:rebind-session-workspace", agent_id, session_id, workspace_id),
    create_session: (agent_id, workspace_id, configuration) => ipcRenderer.invoke("chat:create-session", agent_id, workspace_id, configuration),
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
    set_reasoning_effort: (...args) => ipcRenderer.invoke("chat:set-reasoning-effort", ...args),
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
  group: {
    list: () => ipcRenderer.invoke("group:list"),
    create: (input) => ipcRenderer.invoke("group:create", input),
    generate_draft: (input) => ipcRenderer.invoke("group:generate-draft", input),
    update: (group_id, input) => ipcRenderer.invoke("group:update", group_id, input),
    remove: (group_id) => ipcRenderer.invoke("group:remove", group_id),
    open: (group_id, session_id) => ipcRenderer.invoke("group:open", group_id, session_id),
    list_sessions: (group_id) => ipcRenderer.invoke("group:list-sessions", group_id),
    create_session: (group_id, workspace_id) => ipcRenderer.invoke("group:create-session", group_id, workspace_id),
    rename_session: (group_id, session_id, title) => ipcRenderer.invoke("group:rename-session", group_id, session_id, title),
    list_messages: (group_id, session_id) => ipcRenderer.invoke("group:list-messages", group_id, session_id),
    send: (group_id, session_id, input) => ipcRenderer.invoke("group:send", group_id, session_id, input),
    stop: (group_id, session_id) => ipcRenderer.invoke("group:stop", group_id, session_id),
    respond_interaction: (group_id, session_id, input) => ipcRenderer.invoke("group:respond-interaction", group_id, session_id, input),
    remove_session: (group_id, session_id) => ipcRenderer.invoke("group:remove-session", group_id, session_id),
    subscribe: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) => callback(value);
      ipcRenderer.on("group:event", handler);
      return () => ipcRenderer.removeListener("group:event", handler);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (patch) => ipcRenderer.invoke("settings:update", patch),
    list_env: () => ipcRenderer.invoke("settings:env-list"),
    update_env: (values) => ipcRenderer.invoke("settings:env-update", values),
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
