/** Downcity Desktop Renderer 的 Agent、Session 与 Chat 状态控制器。 */

import { useCallback, useEffect, useState } from "react";
import type { DesktopAgentSummary, DesktopChatMessage, DesktopSessionSummary, DesktopWorkspaceSummary } from "../../common/types/DesktopApi";
import { get_session_key, type AgentRuntimeState, type CreateAgentFormValue, type DesktopViewController, type NavigationTarget } from "../types/DesktopView";

/** 把未知失败统一转换为用户可见文本。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** 管理 Renderer 根状态，并把异步 IPC 细节隔离在视图组件之外。 */
export function use_desktop_controller(): DesktopViewController {
  const [agents, set_agents] = useState<DesktopAgentSummary[]>([]);
  const [workspaces, set_workspaces] = useState<DesktopWorkspaceSummary[]>([]);
  const [workspace_id_by_agent, set_workspace_id_by_agent] = useState<Record<string, string>>({});
  const [sessions_by_agent, set_sessions_by_agent] = useState<Record<string, DesktopSessionSummary[]>>({});
  const [messages_by_session, set_messages_by_session] = useState<Record<string, DesktopChatMessage[]>>({});
  const [runtime_by_agent, set_runtime_by_agent] = useState<Record<string, AgentRuntimeState>>({});
  const [selection, set_selection] = useState<NavigationTarget | null>(null);
  const [sending_session_key, set_sending_session_key] = useState("");
  const [error, set_error] = useState("");
  const [loading, set_loading] = useState(true);

  useEffect(() => {
    const preview_view = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("desktop-preview") : null;
    if (preview_view === "agent" || preview_view === "session") {
      const preview_agent: DesktopAgentSummary = {
        agent_id: "downcity-agent",
        workspace_id: "workspace-preview",
        model_id: "openai/gpt-5.4",
        version: "1.0.0",
      };
      const preview_workspace: DesktopWorkspaceSummary = {
        workspace_id: "workspace-preview",
        workspace_path: "/Users/downcity/Workspace",
        name: "Workspace",
      };
      const preview_session: DesktopSessionSummary = { session_id: "session-preview", title: "构建 Downcity Desktop" };
      set_agents([preview_agent]);
      set_workspaces([preview_workspace]);
      set_workspace_id_by_agent({ [preview_agent.agent_id]: preview_workspace.workspace_id });
      set_runtime_by_agent({ [preview_agent.agent_id]: "connected" });
      set_sessions_by_agent({ [preview_agent.agent_id]: [preview_session] });
      if (preview_view === "session") {
        set_messages_by_session({
          [get_session_key(preview_agent.agent_id, preview_session.session_id)]: [
            { message_id: "preview-user", role: "user", text: "按照 Duobox 的界面实现 Downcity 客户端。", created_at: Date.now() - 60_000, pending: false },
            { message_id: "preview-assistant", role: "assistant", text: "好的。我会保留 Agent 与 Session 的领域结构，并直接复用 Duobox 的应用壳、主题和 Chat 排版。", created_at: Date.now() - 45_000, pending: false },
          ],
        });
        set_selection({ kind: "session", agent_id: preview_agent.agent_id, session_id: preview_session.session_id });
      } else {
        set_selection({ kind: "agent", agent_id: preview_agent.agent_id });
      }
      set_loading(false);
      return;
    }
    void Promise.all([window.downcity.agent.list(), window.downcity.workspace.list()])
      .then(([next_agents, next_workspaces]) => {
        set_agents(next_agents);
        set_workspaces(next_workspaces);
        set_workspace_id_by_agent(Object.fromEntries(
          next_agents.flatMap((agent) => agent.workspace_id
            ? [[agent.agent_id, agent.workspace_id] as const]
            : []),
        ));
        if (next_agents[0]) set_selection({ kind: "agent", agent_id: next_agents[0].agent_id });
      })
      .catch((reason) => set_error(to_error_message(reason)))
      .finally(() => set_loading(false));
  }, []);

  /** 刷新一个已连接 Agent 的 Session 导航数据。 */
  const refresh_sessions = useCallback(async (agent_id: string): Promise<DesktopSessionSummary[]> => {
    const sessions = await window.downcity.chat.list_sessions(agent_id);
    set_sessions_by_agent((current) => ({ ...current, [agent_id]: sessions }));
    return sessions;
  }, []);

  /** 装配 native Agent；同一运行目标重复调用只刷新 Session。 */
  const connect_agent = useCallback(async (agent_id: string): Promise<void> => {
    if (runtime_by_agent[agent_id] === "connected") {
      await refresh_sessions(agent_id);
      return;
    }
    set_error("");
    set_runtime_by_agent((current) => ({ ...current, [agent_id]: "connecting" }));
    try {
      if (!workspace_id_by_agent[agent_id]) throw new Error("Agent 未绑定 Workspace");
      await window.downcity.agent.connect(agent_id);
      set_runtime_by_agent((current) => ({ ...current, [agent_id]: "connected" }));
      await refresh_sessions(agent_id);
    } catch (reason) {
      set_runtime_by_agent((current) => ({ ...current, [agent_id]: "error" }));
      const message = to_error_message(reason);
      set_error(message);
      throw reason;
    }
  }, [refresh_sessions, runtime_by_agent, workspace_id_by_agent]);

  /** 确保后续 Session 操作前已经建立 Agent 连接。 */
  const ensure_connected = useCallback(async (agent_id: string): Promise<void> => {
    if (runtime_by_agent[agent_id] !== "connected") await connect_agent(agent_id);
  }, [connect_agent, runtime_by_agent]);

  const select_agent = useCallback((agent_id: string) => {
    set_error("");
    set_selection({ kind: "agent", agent_id });
  }, []);

  const create_session = useCallback(async (agent_id: string) => {
    set_error("");
    try {
      await ensure_connected(agent_id);
      const session = await window.downcity.chat.create_session(agent_id);
      set_sessions_by_agent((current) => ({
        ...current,
        [agent_id]: [session, ...(current[agent_id] ?? []).filter((item) => item.session_id !== session.session_id)],
      }));
      set_messages_by_session((current) => ({ ...current, [get_session_key(agent_id, session.session_id)]: [] }));
      set_selection({ kind: "session", agent_id, session_id: session.session_id });
    } catch (reason) {
      set_error(to_error_message(reason));
    }
  }, [ensure_connected]);

  const select_session = useCallback(async (agent_id: string, session_id: string) => {
    set_error("");
    set_selection({ kind: "session", agent_id, session_id });
    try {
      await ensure_connected(agent_id);
      const messages = await window.downcity.chat.list_messages(agent_id, session_id);
      set_messages_by_session((current) => ({ ...current, [get_session_key(agent_id, session_id)]: messages }));
    } catch (reason) {
      set_error(to_error_message(reason));
    }
  }, [ensure_connected]);

  const create_agent = useCallback(async (value: CreateAgentFormValue) => {
    set_error("");
    const result = await window.downcity.agent.create(value.agent_id, value.workspace_path, value.model_id);
    set_agents((current) => [...current.filter((item) => item.agent_id !== result.agent.agent_id), result.agent]);
    set_workspaces((current) => [...current.filter((item) => item.workspace_id !== result.workspace.workspace_id), result.workspace]);
    set_workspace_id_by_agent((current) => ({ ...current, [result.agent.agent_id]: result.workspace.workspace_id }));
    set_selection({ kind: "agent", agent_id: result.agent.agent_id });
  }, []);

  const send_message = useCallback(async (agent_id: string, session_id: string, text: string) => {
    const query = text.trim();
    if (!query) return;
    const session_key = get_session_key(agent_id, session_id);
    const optimistic_message: DesktopChatMessage = {
      message_id: `optimistic-${Date.now()}`,
      role: "user",
      text: query,
      created_at: Date.now(),
      pending: false,
    };
    set_error("");
    set_sending_session_key(session_key);
    set_messages_by_session((current) => ({
      ...current,
      [session_key]: [...(current[session_key] ?? []), optimistic_message],
    }));
    try {
      await window.downcity.chat.send(agent_id, session_id, query);
      const messages = await window.downcity.chat.list_messages(agent_id, session_id);
      set_messages_by_session((current) => ({ ...current, [session_key]: messages }));
      await refresh_sessions(agent_id);
    } catch (reason) {
      set_error(to_error_message(reason));
    } finally {
      set_sending_session_key("");
    }
  }, [refresh_sessions]);

  return {
    agents,
    workspaces,
    workspace_id_by_agent,
    sessions_by_agent,
    messages_by_session,
    runtime_by_agent,
    selection,
    sending_session_key,
    error,
    loading,
    select_agent,
    connect_agent,
    create_session,
    select_session,
    create_agent,
    send_message,
    clear_error: () => set_error(""),
  };
}
