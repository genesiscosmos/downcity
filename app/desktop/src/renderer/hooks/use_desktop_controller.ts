/**
 * Downcity Desktop Renderer 根控制器。
 *
 * Session 消息只由 snapshot 与 SDK mutation 构成；输入草稿和待发送队列是
 * Renderer 交互状态，不写回 canonical 消息。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RespondSessionInteractionInput, SessionMutation } from "@downcity/agent";
import type {
  DesktopAgentSummary,
  DesktopAccountResources,
  DesktopAccountSummary,
  DesktopChatFileInput,
  DesktopChatInput,
  DesktopChatReferenceInput,
  DesktopChatRuntime,
  DesktopModelSummary,
  DesktopPluginSummary,
  DesktopSessionConfiguration,
  DesktopSessionSummary,
  DesktopSettings,
  DesktopUserSummary,
  DesktopWorkspaceSummary,
} from "../../common/types/DesktopApi";
import { apply_session_mutation, merge_session_snapshot } from "../lib/chat/session_mutation";
import {
  get_session_key,
  get_draft_session_id,
  is_draft_session_id,
  is_chat_busy,
  type CreateAgentFormValue,
  type CreateWorkspaceFormValue,
  type DesktopViewController,
  type ChatHistoryState,
  type NavigationTarget,
  type QueuedChatMessage,
  type SidebarMode,
  type SettingsSection,
  type DesktopWorkspaceSession,
} from "../types/DesktopView";

const default_settings: DesktopSettings = {
  show_reasoning: true,
  auto_scroll: true,
  default_agent_id: "",
  open_empty_chat_on_start: false,
  send_message_on_enter: true,
  spellcheck_enabled: false,
  appearance_mode: "system",
  color_theme: "duobox",
  ui_scale: 1,
  proxy_enabled: false,
  proxy_url: "",
  default_text_model_id: "",
  default_image_model_id: "",
};
const default_user: DesktopUserSummary = { authenticated: false, federation_url: "https://base.downcity.ai" };
const active_workspace_storage_key = "downcity.active_workspace_id";

/** 把未知失败统一转换为用户可见文本。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** 管理 Renderer 根状态，并把异步 IPC 细节隔离在视图组件之外。 */
export function use_desktop_controller(): DesktopViewController {
  const [agents, set_agents] = useState<DesktopAgentSummary[]>([]);
  const [workspaces, set_workspaces] = useState<DesktopWorkspaceSummary[]>([]);
  const [sessions_by_workspace, set_sessions_by_workspace] = useState<Record<string, DesktopWorkspaceSession[]>>({});
  const [archived_sessions_by_workspace, set_archived_sessions_by_workspace] = useState<Record<string, DesktopWorkspaceSession[]>>({});
  const [messages_by_session, set_messages_by_session] = useState<DesktopViewController["messages_by_session"]>({});
  const [chat_runtime_by_session, set_chat_runtime_by_session] = useState<Record<string, DesktopChatRuntime>>({});
  const [drafts_by_session, set_drafts_by_session] = useState<Record<string, string>>({});
  const [draft_files_by_session, set_draft_files_by_session] = useState<Record<string, DesktopChatFileInput[]>>({});
  const [draft_references_by_session, set_draft_references_by_session] = useState<Record<string, DesktopChatReferenceInput[]>>({});
  const [queued_messages_by_session, set_queued_messages_by_session] = useState<Record<string, QueuedChatMessage[]>>({});
  const [history_by_session, set_history_by_session] = useState<Record<string, ChatHistoryState>>({});
  const [models, set_models] = useState<DesktopModelSummary[]>([]);
  const [plugins, set_plugins] = useState<DesktopPluginSummary[]>([]);
  const [configuration_by_session, set_configuration_by_session] = useState<Record<string, DesktopSessionConfiguration>>({});
  const [models_loading, set_models_loading] = useState(false);
  const [selection, set_selection] = useState<NavigationTarget | null>(null);
  const [active_workspace_id, set_active_workspace_id] = useState("");
  const [sidebar_mode, set_sidebar_mode_state] = useState<SidebarMode>("chat");
  const [settings, set_settings] = useState<DesktopSettings>(default_settings);
  const [user, set_user] = useState<DesktopUserSummary>(default_user);
  const [accounts, set_accounts] = useState<DesktopAccountSummary[]>([]);
  const [account_resources, set_account_resources] = useState<DesktopAccountResources>();
  const [error, set_error] = useState("");
  const [loading, set_loading] = useState(true);

  const chat_runtime_ref = useRef(chat_runtime_by_session);
  const queue_ref = useRef(queued_messages_by_session);
  const history_ref = useRef(history_by_session);
  const mutation_batches_ref = useRef(new Map<string, SessionMutation[]>());
  const mutation_frame_ref = useRef<number | null>(null);
  const snapshot_request_ref = useRef(new Map<string, number>());
  const processing_queue_ref = useRef(new Set<string>());
  const previous_selection_ref = useRef<NavigationTarget | null>(null);

  useEffect(() => { chat_runtime_ref.current = chat_runtime_by_session; }, [chat_runtime_by_session]);
  useEffect(() => { queue_ref.current = queued_messages_by_session; }, [queued_messages_by_session]);
  useEffect(() => { history_ref.current = history_by_session; }, [history_by_session]);

  /** 保存队列并同步异步回调读取的引用。 */
  const commit_queue = useCallback((next: Record<string, QueuedChatMessage[]>) => {
    queue_ref.current = next;
    set_queued_messages_by_session(next);
  }, []);

  /** 提交队首消息；同一 Session 同时只执行一个提交循环。 */
  const process_next_queue = useCallback(async (workspace_id: string, agent_id: string, session_id: string): Promise<void> => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    if (processing_queue_ref.current.has(session_key) || is_chat_busy(chat_runtime_ref.current[session_key])) return;
    const queued = queue_ref.current[session_key]?.[0];
    if (!queued) return;
    processing_queue_ref.current.add(session_key);
    commit_queue({
      ...queue_ref.current,
      [session_key]: (queue_ref.current[session_key] ?? []).map((item, index) => index === 0 ? { ...item, sending: true } : item),
    });
    let accepted = false;
    try {
      await window.downcity.chat.send(agent_id, workspace_id, session_id, queued.input);
      accepted = true;
      commit_queue({
        ...queue_ref.current,
        [session_key]: (queue_ref.current[session_key] ?? []).filter((item) => item.message_id !== queued.message_id),
      });
    } catch (reason) {
      commit_queue({
        ...queue_ref.current,
        [session_key]: (queue_ref.current[session_key] ?? []).map((item) => item.message_id === queued.message_id ? { ...item, sending: false } : item),
      });
      set_error(to_error_message(reason));
    } finally {
      processing_queue_ref.current.delete(session_key);
      if (accepted && !is_chat_busy(chat_runtime_ref.current[session_key])) {
        void process_next_queue(workspace_id, agent_id, session_id);
      }
    }
  }, [commit_queue]);

  useEffect(() => {
    void Promise.all([
      window.downcity.agent.list(),
      window.downcity.workspace.list(),
      window.downcity.settings.get(),
      window.downcity.plugin.list(),
    ]).then(async ([next_agents, next_workspaces, next_settings, next_plugins]) => {
      set_agents(next_agents);
      set_workspaces(next_workspaces);
      set_settings(next_settings);
      set_plugins(next_plugins);
      const initial_agent = next_agents.find((agent) => agent.agent_id === next_settings.default_agent_id) ?? next_agents[0];
      const stored_workspace_id = localStorage.getItem(active_workspace_storage_key) || "";
      const initial_workspace = next_workspaces.find((workspace) => workspace.workspace_id === stored_workspace_id)
        ?? next_workspaces[0];
      if (initial_workspace) {
        set_active_workspace_id(initial_workspace.workspace_id);
        localStorage.setItem(active_workspace_storage_key, initial_workspace.workspace_id);
      }
      if (initial_agent && initial_workspace && next_settings.open_empty_chat_on_start) {
        set_selection({ kind: "draft", workspace_id: initial_workspace.workspace_id, agent_id: initial_agent.agent_id, draft_id: get_draft_session_id(initial_agent.agent_id) });
      } else if (initial_workspace) {
        set_selection({ kind: "workspace", workspace_id: initial_workspace.workspace_id });
      }
    }).catch((reason) => set_error(to_error_message(reason))).finally(() => set_loading(false));
    // 关键点（中文）：远端资料刷新不能阻塞本地 Agent、Workspace 与设置进入可用状态。
    void window.downcity.user.current()
      .then((current_user) => {
        set_user(current_user);
        void window.downcity.user.list_accounts().then(set_accounts).catch(() => undefined);
        if (current_user.authenticated) {
          set_models_loading(true);
          void window.downcity.chat.list_models()
            .then(set_models)
            .catch(() => set_models([]))
            .finally(() => set_models_loading(false));
          void window.downcity.user.get_resources().then(set_account_resources).catch(() => undefined);
        }
      })
      .catch((reason) => set_user((current) => ({ ...current, error: to_error_message(reason) })));
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply_appearance = () => {
      const dark = settings.appearance_mode === "dark"
        || (settings.appearance_mode === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.dataset.theme = settings.color_theme;
      document.documentElement.style.fontSize = `${16 * settings.ui_scale}px`;
    };
    apply_appearance();
    media.addEventListener("change", apply_appearance);
    return () => media.removeEventListener("change", apply_appearance);
  }, [settings.appearance_mode, settings.color_theme, settings.ui_scale]);

  /** 一次读取全部 Workspace 的 Session，Sidebar 展开状态不参与数据生命周期。 */
  useEffect(() => {
    if (workspaces.length === 0 || agents.length === 0) return;
    let cancelled = false;
    void Promise.all(workspaces.map(async (workspace) => {
      const entries = await Promise.all(agents.map(async (agent) => {
        const sessions = await window.downcity.chat.list_sessions(agent.agent_id, workspace.workspace_id);
        return sessions.map((session) => ({ agent_id: agent.agent_id, session }));
      }));
      return [workspace.workspace_id, entries.flat()] as const;
    })).then((entries) => {
      if (cancelled) return;
      set_sessions_by_workspace(Object.fromEntries(entries));
    }).catch((reason) => {
      if (!cancelled) set_error(to_error_message(reason));
    });
    return () => { cancelled = true; };
  }, [agents, workspaces]);

  useEffect(() => {
    const unsubscribe_mutation = window.downcity.chat.on_mutation(({ agent_id, workspace_id, session_id, mutation }) => {
      const session_key = get_session_key(workspace_id, agent_id, session_id);
      const batch = mutation_batches_ref.current.get(session_key) ?? [];
      batch.push(mutation);
      mutation_batches_ref.current.set(session_key, batch);
      if (mutation.variant === "session" && mutation.type === "title") {
        set_sessions_by_workspace((current) => ({
          ...current,
          [workspace_id]: (current[workspace_id] ?? []).map((item) => item.agent_id === agent_id && item.session.session_id === session_id
            ? { ...item, session: { ...item.session, title: mutation.title, updated_at: mutation.created_at } }
            : item),
        }));
      }
      if (mutation_frame_ref.current !== null) return;
      mutation_frame_ref.current = requestAnimationFrame(() => {
        const batches = mutation_batches_ref.current;
        mutation_batches_ref.current = new Map();
        mutation_frame_ref.current = null;
        set_messages_by_session((current) => {
          const next = { ...current };
          for (const [key, mutations] of batches) {
            next[key] = mutations.reduce(apply_session_mutation, next[key] ?? []);
          }
          return next;
        });
      });
    });
    const unsubscribe_runtime = window.downcity.chat.on_runtime(({ runtime }) => {
      const session_key = get_session_key(runtime.workspace_id, runtime.agent_id, runtime.session_id);
      chat_runtime_ref.current = { ...chat_runtime_ref.current, [session_key]: runtime };
      set_chat_runtime_by_session(chat_runtime_ref.current);
      set_sessions_by_workspace((current) => ({
        ...current,
        [runtime.workspace_id]: (current[runtime.workspace_id] ?? []).map((item) => item.agent_id === runtime.agent_id && item.session.session_id === runtime.session_id
          ? { ...item, session: { ...item.session, executing: is_chat_busy(runtime), updated_at: runtime.updated_at } }
          : item),
      }));
      if (!is_chat_busy(runtime)) void process_next_queue(runtime.workspace_id, runtime.agent_id, runtime.session_id);
    });
    return () => {
      unsubscribe_mutation();
      unsubscribe_runtime();
      if (mutation_frame_ref.current !== null) cancelAnimationFrame(mutation_frame_ref.current);
    };
  }, [process_next_queue]);

  const select_agent = useCallback((agent_id: string) => {
    set_error("");
    set_selection({ kind: "agent", agent_id });
  }, []);

  const select_plugin = useCallback((plugin_id: string) => {
    set_error("");
    set_sidebar_mode_state("plugins");
    set_selection({ kind: "plugin", plugin_id });
  }, []);

  const set_sidebar_mode = useCallback((mode: SidebarMode) => {
    set_sidebar_mode_state(mode);
  }, []);

  const select_workspace = useCallback((workspace_id: string) => {
    if (!workspaces.some((workspace) => workspace.workspace_id === workspace_id)) return;
    set_error("");
    set_sidebar_mode_state("chat");
    set_active_workspace_id(workspace_id);
    localStorage.setItem(active_workspace_storage_key, workspace_id);
    set_selection({ kind: "workspace", workspace_id });
  }, [workspaces]);

  const open_settings = useCallback((section: SettingsSection = "user") => {
    set_error("");
    if (selection?.kind !== "settings") previous_selection_ref.current = selection;
    set_selection({ kind: "settings", section });
  }, [selection]);

  const close_settings = useCallback(() => {
    set_selection(previous_selection_ref.current ?? (agents[0] ? { kind: "agent", agent_id: agents[0].agent_id } : null));
  }, [agents]);

  const create_session = useCallback(async (workspace_id: string, agent_id: string) => {
    set_error("");
    set_sidebar_mode_state("chat");
    const draft_id = get_draft_session_id(agent_id);
    const session_key = get_session_key(workspace_id, agent_id, draft_id);
    const agent = agents.find((item) => item.agent_id === agent_id);
    set_configuration_by_session((current) => ({
      ...current,
      [session_key]: current[session_key] ?? { model_id: agent?.model_id || "", approval_mode: "ask" },
    }));
    set_active_workspace_id(workspace_id);
    set_selection({ kind: "draft", workspace_id, agent_id, draft_id });
  }, [agents]);

  const select_session = useCallback(async (workspace_id: string, agent_id: string, session_id: string) => {
    set_error("");
    set_sidebar_mode_state("chat");
    set_active_workspace_id(workspace_id);
    set_selection({ kind: "session", workspace_id, agent_id, session_id });
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    const request_id = (snapshot_request_ref.current.get(session_key) ?? 0) + 1;
    snapshot_request_ref.current.set(session_key, request_id);
    try {
      const [snapshot, configuration] = await Promise.all([
        window.downcity.chat.get_snapshot(agent_id, workspace_id, session_id),
        window.downcity.chat.get_configuration(agent_id, workspace_id, session_id),
      ]);
      if (snapshot_request_ref.current.get(session_key) !== request_id) return;
      set_messages_by_session((current) => ({ ...current, [session_key]: merge_session_snapshot(current[session_key] ?? [], snapshot.messages) }));
      const history_state = { loading: false, has_more: snapshot.has_more, next_before_sequence: snapshot.next_before_sequence };
      history_ref.current = { ...history_ref.current, [session_key]: history_state };
      set_history_by_session(history_ref.current);
      const current_runtime = chat_runtime_ref.current[session_key];
      const next_runtime = current_runtime && current_runtime.updated_at > snapshot.runtime.updated_at ? current_runtime : snapshot.runtime;
      chat_runtime_ref.current = { ...chat_runtime_ref.current, [session_key]: next_runtime };
      set_chat_runtime_by_session(chat_runtime_ref.current);
      set_configuration_by_session((current) => ({ ...current, [session_key]: configuration }));
    } catch (reason) {
      set_error(to_error_message(reason));
    }
  }, []);

  const rename_session = useCallback(async (workspace_id: string, agent_id: string, session_id: string, title: string) => {
    try {
      const normalized_title = await window.downcity.chat.rename_session(agent_id, workspace_id, session_id, title);
      set_sessions_by_workspace((current) => ({
        ...current,
        [workspace_id]: (current[workspace_id] ?? []).map((item) => item.agent_id === agent_id && item.session.session_id === session_id
          ? { ...item, session: { ...item.session, title: normalized_title, updated_at: Date.now() } }
          : item),
      }));
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, []);

  const archive_session = useCallback(async (workspace_id: string, agent_id: string, session_id: string) => {
    try {
      await window.downcity.chat.archive_session(agent_id, workspace_id, session_id);
      set_sessions_by_workspace((current) => ({
        ...current,
        [workspace_id]: (current[workspace_id] ?? []).filter((item) => item.agent_id !== agent_id || item.session.session_id !== session_id),
      }));
      set_selection((current) => current?.kind === "session" && current.workspace_id === workspace_id && current.agent_id === agent_id && current.session_id === session_id
        ? { kind: "draft", workspace_id, agent_id, draft_id: get_draft_session_id(agent_id) }
        : current);
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, []);

  const remove_session = useCallback(async (workspace_id: string, agent_id: string, session_id: string) => {
    try {
      const removed = await window.downcity.chat.remove_session(agent_id, workspace_id, session_id);
      if (!removed) return;
      set_sessions_by_workspace((current) => ({
        ...current,
        [workspace_id]: (current[workspace_id] ?? []).filter((item) => item.agent_id !== agent_id || item.session.session_id !== session_id),
      }));
      set_selection((current) => current?.kind === "session" && current.workspace_id === workspace_id && current.agent_id === agent_id && current.session_id === session_id
        ? { kind: "draft", workspace_id, agent_id, draft_id: get_draft_session_id(agent_id) }
        : current);
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, []);

  const load_archived_sessions = useCallback(async (workspace_id: string) => {
    try {
      const entries = await Promise.all(agents.map(async (agent) => {
        const sessions = await window.downcity.chat.list_archived_sessions(agent.agent_id, workspace_id);
        return sessions.map((session) => ({ agent_id: agent.agent_id, session }));
      }));
      set_archived_sessions_by_workspace((current) => ({ ...current, [workspace_id]: entries.flat() }));
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, [agents]);

  const load_earlier_history = useCallback(async (workspace_id: string, agent_id: string, session_id: string) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    const current_history = history_ref.current[session_key];
    if (!current_history?.has_more || !current_history.next_before_sequence || current_history.loading) return;
    const loading_history = { ...current_history, loading: true };
    history_ref.current = { ...history_ref.current, [session_key]: loading_history };
    set_history_by_session(history_ref.current);
    try {
      const page = await window.downcity.chat.get_history(agent_id, workspace_id, session_id, current_history.next_before_sequence);
      set_messages_by_session((current) => ({ ...current, [session_key]: merge_session_snapshot(current[session_key] ?? [], page.messages) }));
      const next_history = { loading: false, has_more: page.has_more, next_before_sequence: page.next_before_sequence };
      history_ref.current = { ...history_ref.current, [session_key]: next_history };
      set_history_by_session(history_ref.current);
    } catch (reason) {
      const next_history = { ...loading_history, loading: false };
      history_ref.current = { ...history_ref.current, [session_key]: next_history };
      set_history_by_session(history_ref.current);
      set_error(to_error_message(reason));
    }
  }, []);

  const create_agent = useCallback(async (value: CreateAgentFormValue) => {
    set_error("");
    const result = await window.downcity.agent.create(value.agent_id, value.model_id);
    set_agents((current) => [...current.filter((item) => item.agent_id !== result.agent.agent_id), result.agent]);
    set_sidebar_mode_state("agents");
    set_selection({ kind: "agent", agent_id: result.agent.agent_id });
  }, []);

  const get_agent = useCallback(async (agent_id: string) => {
    return await window.downcity.agent.get(agent_id);
  }, []);

  const update_agent = useCallback(async (agent_id: string, input: Parameters<typeof window.downcity.agent.update>[1]) => {
    set_error("");
    try {
      const agent = await window.downcity.agent.update(agent_id, input);
      set_agents((current) => current.map((item) => item.agent_id === agent.agent_id ? agent : item));
      set_plugins(await window.downcity.plugin.list());
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, []);

  const get_plugin = useCallback(async (plugin_id: string) => {
    return await window.downcity.plugin.get(plugin_id);
  }, []);

  const save_plugin_profile = useCallback(async (plugin_id: string, input: Parameters<typeof window.downcity.plugin.save_profile>[1]) => {
    set_error("");
    try {
      const definition = await window.downcity.plugin.save_profile(plugin_id, input);
      set_plugins(await window.downcity.plugin.list());
      return definition;
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, []);

  const remove_plugin_profile = useCallback(async (plugin_id: string, profile_id: string) => {
    set_error("");
    try {
      const definition = await window.downcity.plugin.remove_profile(plugin_id, profile_id);
      set_plugins(await window.downcity.plugin.list());
      return definition;
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, []);

  const create_workspace = useCallback(async (value: CreateWorkspaceFormValue) => {
    set_error("");
    const workspace = await window.downcity.workspace.create(value.workspace_path, value.name);
    set_workspaces((current) => [...current.filter((item) => item.workspace_id !== workspace.workspace_id), workspace]);
    set_sidebar_mode_state("chat");
    set_active_workspace_id(workspace.workspace_id);
    localStorage.setItem(active_workspace_storage_key, workspace.workspace_id);
    set_selection({ kind: "workspace", workspace_id: workspace.workspace_id });
  }, []);

  const update_draft = useCallback((workspace_id: string, agent_id: string, session_id: string, text: string) => {
    set_drafts_by_session((current) => ({
      ...current,
      [get_session_key(workspace_id, agent_id, session_id)]: text,
    }));
  }, []);

  const update_draft_files = useCallback((workspace_id: string, agent_id: string, session_id: string, files: DesktopChatFileInput[]) => {
    set_draft_files_by_session((current) => ({
      ...current,
      [get_session_key(workspace_id, agent_id, session_id)]: files,
    }));
  }, []);

  const update_draft_references = useCallback((workspace_id: string, agent_id: string, session_id: string, references: DesktopChatReferenceInput[]) => {
    set_draft_references_by_session((current) => ({
      ...current,
      [get_session_key(workspace_id, agent_id, session_id)]: references,
    }));
  }, []);

  const send_message = useCallback(async (workspace_id: string, agent_id: string, session_id: string, input: DesktopChatInput) => {
    const normalized_input: DesktopChatInput = {
      text: String(input.text || "").trim(),
      files: Array.isArray(input.files) ? input.files : [],
      references: Array.isArray(input.references) ? input.references : [],
    };
    if (!normalized_input.text && normalized_input.files.length === 0 && normalized_input.references.length === 0) return;
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    set_error("");
    set_drafts_by_session((current) => ({ ...current, [session_key]: "" }));
    set_draft_files_by_session((current) => ({ ...current, [session_key]: [] }));
    set_draft_references_by_session((current) => ({ ...current, [session_key]: [] }));
    if (is_draft_session_id(session_id)) {
      try {
        const session = await window.downcity.chat.create_session(agent_id, workspace_id);
        set_sessions_by_workspace((current) => ({
          ...current,
          [workspace_id]: [{ agent_id, session }, ...(current[workspace_id] ?? []).filter((item) => item.agent_id !== agent_id || item.session.session_id !== session.session_id)],
        }));
        const actual_key = get_session_key(workspace_id, agent_id, session.session_id);
        const agent = agents.find((item) => item.agent_id === agent_id);
        const draft_configuration = configuration_by_session[session_key] ?? {
          model_id: settings.default_text_model_id || agent?.model_id || "",
          approval_mode: "ask",
        };
        set_selection({ kind: "session", workspace_id, agent_id, session_id: session.session_id });
        let actual_configuration = await window.downcity.chat.get_configuration(agent_id, workspace_id, session.session_id);
        if (draft_configuration.model_id && draft_configuration.model_id !== actual_configuration.model_id) {
          actual_configuration = await window.downcity.chat.set_model(agent_id, workspace_id, session.session_id, draft_configuration.model_id);
        }
        if (draft_configuration.approval_mode !== actual_configuration.approval_mode) {
          actual_configuration = await window.downcity.chat.set_approval_mode(agent_id, workspace_id, session.session_id, draft_configuration.approval_mode);
        }
        set_configuration_by_session((current) => ({ ...current, [actual_key]: actual_configuration }));
        await window.downcity.chat.send(agent_id, workspace_id, session.session_id, normalized_input);
        set_drafts_by_session((current) => ({ ...current, [actual_key]: "" }));
      } catch (reason) {
        set_drafts_by_session((current) => ({ ...current, [session_key]: normalized_input.text }));
        set_draft_files_by_session((current) => ({ ...current, [session_key]: normalized_input.files }));
        set_draft_references_by_session((current) => ({ ...current, [session_key]: normalized_input.references }));
        set_error(to_error_message(reason));
        throw reason;
      }
      return;
    }
    if (is_chat_busy(chat_runtime_ref.current[session_key]) || (queue_ref.current[session_key]?.length ?? 0) > 0) {
      const queued: QueuedChatMessage = {
        message_id: crypto.randomUUID(),
        input: normalized_input,
        created_at: Date.now(),
        sending: false,
      };
      commit_queue({ ...queue_ref.current, [session_key]: [...(queue_ref.current[session_key] ?? []), queued] });
      if (!is_chat_busy(chat_runtime_ref.current[session_key])) void process_next_queue(workspace_id, agent_id, session_id);
      return;
    }
    try {
      await window.downcity.chat.send(agent_id, workspace_id, session_id, normalized_input);
    } catch (reason) {
      set_drafts_by_session((current) => ({ ...current, [session_key]: normalized_input.text }));
      set_draft_files_by_session((current) => ({ ...current, [session_key]: normalized_input.files }));
      set_draft_references_by_session((current) => ({ ...current, [session_key]: normalized_input.references }));
      set_error(to_error_message(reason));
    }
  }, [agents, commit_queue, configuration_by_session, process_next_queue, settings.default_text_model_id]);

  const refresh_models = useCallback(async () => {
    set_models_loading(true);
    try {
      set_models(await window.downcity.chat.list_models());
    } catch (reason) {
      set_models([]);
      set_error(to_error_message(reason));
    } finally {
      set_models_loading(false);
    }
  }, []);

  const set_session_model = useCallback(async (workspace_id: string, agent_id: string, session_id: string, model_id: string) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    try {
      if (is_draft_session_id(session_id)) {
        const current = configuration_by_session[session_key] ?? { model_id, approval_mode: "ask" as const };
        set_configuration_by_session((values) => ({ ...values, [session_key]: { ...current, model_id } }));
        return;
      }
      const configuration = await window.downcity.chat.set_model(agent_id, workspace_id, session_id, model_id);
      set_configuration_by_session((current) => ({ ...current, [session_key]: configuration }));
    } catch (reason) {
      set_error(to_error_message(reason));
    }
  }, [configuration_by_session]);

  const set_session_approval_mode = useCallback(async (
    workspace_id: string,
    agent_id: string,
    session_id: string,
    approval_mode: DesktopSessionConfiguration["approval_mode"],
  ) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    try {
      if (is_draft_session_id(session_id)) {
        const agent = agents.find((item) => item.agent_id === agent_id);
        const current = configuration_by_session[session_key] ?? { model_id: agent?.model_id || "", approval_mode };
        set_configuration_by_session((values) => ({ ...values, [session_key]: { ...current, approval_mode } }));
        return;
      }
      const configuration = await window.downcity.chat.set_approval_mode(agent_id, workspace_id, session_id, approval_mode);
      set_configuration_by_session((current) => ({ ...current, [session_key]: configuration }));
    } catch (reason) {
      set_error(to_error_message(reason));
    }
  }, [agents, configuration_by_session]);

  const stop_session = useCallback(async (workspace_id: string, agent_id: string, session_id: string) => {
    try {
      await window.downcity.chat.stop(agent_id, workspace_id, session_id);
    } catch (reason) {
      set_error(to_error_message(reason));
    }
  }, []);

  const respond_interaction = useCallback(async (
    workspace_id: string,
    agent_id: string,
    session_id: string,
    input: RespondSessionInteractionInput,
  ) => {
    try {
      await window.downcity.chat.respond(agent_id, workspace_id, session_id, input);
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, []);

  const remove_queued_message = useCallback((workspace_id: string, agent_id: string, session_id: string, message_id: string) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    commit_queue({
      ...queue_ref.current,
      [session_key]: (queue_ref.current[session_key] ?? []).filter((item) => item.message_id !== message_id || item.sending),
    });
  }, [commit_queue]);

  const move_queued_message = useCallback((workspace_id: string, agent_id: string, session_id: string, message_id: string, direction: "up" | "down") => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    const queue = [...(queue_ref.current[session_key] ?? [])];
    const index = queue.findIndex((item) => item.message_id === message_id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= queue.length || queue[index].sending || queue[target].sending) return;
    [queue[index], queue[target]] = [queue[target], queue[index]];
    commit_queue({ ...queue_ref.current, [session_key]: queue });
  }, [commit_queue]);

  const update_settings = useCallback(async (patch: Partial<DesktopSettings>) => {
    try {
      set_settings(await window.downcity.settings.update(patch));
    } catch (reason) {
      set_error(to_error_message(reason));
    }
  }, []);

  const list_login_providers = useCallback(async (federation_url: string, force_refresh = false) => {
    set_error("");
    try {
      return await window.downcity.user.list_login_providers(federation_url, force_refresh);
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, []);

  const login = useCallback(async (federation_url: string, provider_id: string) => {
    set_error("");
    let pending_login_id = "";
    try {
      const started = await window.downcity.user.start_login({ federation_url, provider_id });
      pending_login_id = started.status === "done" ? "" : started.login_id;
      if (started.status === "input_required") throw new Error("当前 Desktop 暂不支持需要输入信息的登录方式");
      if (started.status !== "done") {
        let completed = false;
        for (let attempt = 0; attempt < 180; attempt += 1) {
          const result = await window.downcity.user.get_login_result(started.login_id);
          if (result.status === "error") throw new Error(result.error || "登录失败");
          if (result.status === "done") {
            pending_login_id = "";
            completed = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        if (!completed) throw new Error("登录授权已超时，请重试");
      }
      set_user(await window.downcity.user.current());
      set_accounts(await window.downcity.user.list_accounts());
      set_account_resources(await window.downcity.user.get_resources());
      void refresh_models();
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    } finally {
      if (pending_login_id) await window.downcity.user.cancel_login(pending_login_id).catch(() => undefined);
    }
  }, [refresh_models]);

  const logout = useCallback(async () => {
    set_error("");
    try {
      set_user(await window.downcity.user.logout());
      set_accounts(await window.downcity.user.list_accounts());
      set_account_resources(undefined);
      set_models([]);
    } catch (reason) {
      set_error(to_error_message(reason));
    }
  }, []);

  const switch_account = useCallback(async (account_id: string) => {
    set_error("");
    try {
      set_user(await window.downcity.user.switch_account(account_id));
      set_accounts(await window.downcity.user.list_accounts());
      set_account_resources(await window.downcity.user.get_resources());
      await refresh_models();
    } catch (reason) { set_error(to_error_message(reason)); throw reason; }
  }, [refresh_models]);

  const remove_account = useCallback(async (account_id: string) => {
    set_error("");
    try {
      set_user(await window.downcity.user.remove_account(account_id));
      set_accounts(await window.downcity.user.list_accounts());
      const current = await window.downcity.user.current();
      if (current.authenticated) set_account_resources(await window.downcity.user.get_resources()); else { set_account_resources(undefined); set_models([]); }
    } catch (reason) { set_error(to_error_message(reason)); throw reason; }
  }, []);

  return {
    agents,
    workspaces,
    sessions_by_workspace,
    archived_sessions_by_workspace,
    messages_by_session,
    chat_runtime_by_session,
    drafts_by_session,
    draft_files_by_session,
    draft_references_by_session,
    queued_messages_by_session,
    history_by_session,
    models,
    plugins,
    configuration_by_session,
    models_loading,
    selection,
    active_workspace_id,
    sidebar_mode,
    settings,
    user,
    accounts,
    account_resources,
    error,
    loading,
    select_agent,
    select_plugin,
    set_sidebar_mode,
    select_workspace,
    open_settings,
    close_settings,
    create_session,
    select_session,
    rename_session,
    archive_session,
    remove_session,
    load_archived_sessions,
    load_earlier_history,
    create_agent,
    get_agent,
    update_agent,
    get_plugin,
    save_plugin_profile,
    remove_plugin_profile,
    create_workspace,
    update_draft,
    update_draft_files,
    update_draft_references,
    send_message,
    refresh_models,
    set_session_model,
    set_session_approval_mode,
    stop_session,
    respond_interaction,
    remove_queued_message,
    move_queued_message,
    update_settings,
    login,
    list_login_providers,
    logout,
    switch_account,
    remove_account,
    clear_error: () => set_error(""),
  };
}
