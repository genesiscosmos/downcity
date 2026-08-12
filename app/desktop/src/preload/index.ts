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
  },
  chat: {
    list_sessions: (agent_id) => ipcRenderer.invoke("chat:list-sessions", agent_id),
    create_session: (agent_id) => ipcRenderer.invoke("chat:create-session", agent_id),
    list_messages: (agent_id, session_id) => ipcRenderer.invoke("chat:list-messages", agent_id, session_id),
    send: (agent_id, session_id, text) => ipcRenderer.invoke("chat:send", agent_id, session_id, text),
  },
};

contextBridge.exposeInMainWorld("downcity", desktop_api);
