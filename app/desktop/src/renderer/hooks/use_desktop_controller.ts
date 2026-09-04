/**
 * Downcity Desktop Renderer 根控制器。
 *
 * Session 消息只由 snapshot 与 SDK mutation 构成；输入草稿和待发送队列是
 * Renderer 交互状态，不写回 canonical 消息。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RespondSessionInteractionInput, SessionMutation } from "@downcity/agent";
import type { JSONContent } from "@tiptap/core";
import type {
  DesktopAgentSummary,
  DesktopAccountResources,
  DesktopAccountSummary,
  DesktopChatRewriteInput,
  DesktopChatRuntime,
  DesktopCreateGroupInput,
  DesktopUpdateGroupInput,
  DesktopGroupSummary,
  DesktopGroupMessage,
  DesktopGroupMemberRuntime,
  DesktopGroupStatusPhase,
  DesktopModelSummary,
  DesktopPluginSummary,
  DesktopSessionConfiguration,
  DesktopSessionSummary,
  DesktopSettings,
  DesktopUserSummary,
  DesktopWorkspaceSummary,
} from "../../common/types/DesktopApi";
import type { DesktopNotificationState } from "../../common/types/DesktopNotification";
import { apply_session_mutation, merge_session_snapshot } from "../lib/chat/session_mutation";
import {
  desktop_navigation_storage_key,
  get_sidebar_mode_for_navigation,
  is_restorable_navigation_target,
  parse_navigation_target,
  resolve_navigation_target,
} from "../lib/navigation/desktop_navigation_state";
import {
  get_session_key,
  get_draft_session_id,
  get_group_chat_key,
  get_group_draft_session_id,
  is_draft_session_id,
  is_group_draft_session_id,
  is_chat_busy,
  type ChatSubmitMode,
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
import { notification_target_from_navigation } from "../lib/notification/notification_state";
import { update_group_session_title, update_group_session_title_index } from "../lib/group/group_session_projection";
import { create_chat_composer, is_chat_composer_empty, read_chat_composer_text } from "../lib/chat/editor/chatComposerCodec";

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
  agent_main_sessions: {},
  group_main_sessions: {},
};
const default_user: DesktopUserSummary = { authenticated: false, federation_url: "https://base.downcity.ai" };
const active_workspace_storage_key = "downcity.active_workspace_id";
const default_notification_state: DesktopNotificationState = { revision: 0, notifications: [], unread_count: 0 };

/** 返回导航目标所属的主导航业务集合；设置页不属于任何业务集合。 */
function get_sidebar_mode_for_target(target: NavigationTarget): SidebarMode | undefined {
  if (target.kind === "workspace" || target.kind === "workspace_file") return "workspace";
  if (target.kind === "plugin" || target.kind === "plugins") return "plugins";
  if (target.kind === "plugin_workspace") return plugin_workspace_mode(target.plugin_id);
  if (target.kind === "settings") return undefined;
  return "chat";
}

/** 为功能型 Plugin 创建稳定的一级导航模式。 */
function plugin_workspace_mode(plugin_id: string): SidebarMode {
  return `plugin:${plugin_id}`;
}

/** 从动态一级导航模式读取 Plugin ID。 */
function plugin_id_from_sidebar_mode(mode: SidebarMode): string | undefined {
  return mode.startsWith("plugin:") ? mode.slice("plugin:".length) : undefined;
}

/** 将一项 Draft 状态移动到新组合键，避免切换上下文后留下过期副本。 */
function move_draft_value<Value>(current: Record<string, Value>, source_key: string, target_key: string, fallback: Value): Record<string, Value> {
  const next = { ...current, [target_key]: current[source_key] ?? fallback };
  delete next[source_key];
  return next;
}

/** 从 Session 索引状态中移除一个键，并在无需修改时保留原引用。 */
function remove_session_value<Value>(current: Record<string, Value>, session_key: string): Record<string, Value> {
  if (!(session_key in current)) return current;
  const next = { ...current };
  delete next[session_key];
  return next;
}

/** 把未知失败统一转换为用户可见文本。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** 把新版原文或旧版 key/value Env 响应统一收敛为编辑器文本。 */
function normalize_global_env_text(input: unknown): string {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const lines = Object.entries(input).map(([key, value]) => `${key}=${String(value ?? "")}`);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/** 管理 Renderer 根状态，并把异步 IPC 细节隔离在视图组件之外。 */
export function use_desktop_controller(): DesktopViewController {
  const [notification_state, set_notification_state] = useState<DesktopNotificationState>(default_notification_state);
  const [agents, set_agents] = useState<DesktopAgentSummary[]>([]);
  const [workspaces, set_workspaces] = useState<DesktopWorkspaceSummary[]>([]);
  const [groups, set_groups] = useState<DesktopGroupSummary[]>([]);
  const [groups_by_id, set_groups_by_id] = useState<Record<string, DesktopGroupSummary>>({});
  const [group_messages_by_group, set_group_messages_by_group] = useState<Record<string, DesktopGroupMessage[]>>({});
  const [group_member_statuses_by_group, set_group_member_statuses_by_group] = useState<Record<string, DesktopGroupMemberRuntime[]>>({});
  const [group_phase_by_group, set_group_phase_by_group] = useState<Record<string, DesktopGroupStatusPhase>>({});
  const [group_read_message_ids_by_group, set_group_read_message_ids_by_group] = useState<Record<string, string[]>>({});
  const [group_interactions_by_group, set_group_interactions_by_group] = useState<DesktopViewController["group_interactions_by_group"]>({});
  const [sessions_by_workspace, set_sessions_by_workspace] = useState<Record<string, DesktopWorkspaceSession[]>>({});
  const [group_sessions_by_workspace, set_group_sessions_by_workspace] = useState<DesktopViewController["group_sessions_by_workspace"]>({});
  const [archived_sessions_by_workspace, set_archived_sessions_by_workspace] = useState<Record<string, DesktopWorkspaceSession[]>>({});
  const [messages_by_session, set_messages_by_session] = useState<DesktopViewController["messages_by_session"]>({});
  const [chat_runtime_by_session, set_chat_runtime_by_session] = useState<Record<string, DesktopChatRuntime>>({});
  const [draft_content_by_session, set_draft_content_by_session] = useState<Record<string, JSONContent>>({});
  const [queued_messages_by_session, set_queued_messages_by_session] = useState<Record<string, QueuedChatMessage[]>>({});
  const [queue_paused_by_session, set_queue_paused_by_session] = useState<Record<string, boolean>>({});
  const [history_by_session, set_history_by_session] = useState<Record<string, ChatHistoryState>>({});
  const [models, set_models] = useState<DesktopModelSummary[]>([]);
  const [plugins, set_plugins] = useState<DesktopPluginSummary[]>([]);
  const [configuration_by_session, set_configuration_by_session] = useState<Record<string, DesktopSessionConfiguration>>({});
  const [models_loading, set_models_loading] = useState(false);
  const [selection, set_selection] = useState<NavigationTarget | null>(null);
  const [active_workspace_id, set_active_workspace_id] = useState("");
  const [sidebar_mode, set_sidebar_mode_state] = useState<SidebarMode>("chat");
  const [plugin_routes, set_plugin_routes] = useState<Record<string, import("@downcity/plugin").PluginJsonObject>>({});
  const [plugin_revisions, set_plugin_revisions] = useState<Record<string, number>>({});
  const [settings, set_settings] = useState<DesktopSettings>(default_settings);
  const [global_env, set_global_env] = useState("");
  const [user, set_user] = useState<DesktopUserSummary>(default_user);
  const [accounts, set_accounts] = useState<DesktopAccountSummary[]>([]);
  const [account_resources, set_account_resources] = useState<DesktopAccountResources>();
  const [error, set_error] = useState("");
  const [loading, set_loading] = useState(true);

  const chat_runtime_ref = useRef(chat_runtime_by_session);
  const queue_ref = useRef(queued_messages_by_session);
  const queue_paused_ref = useRef(queue_paused_by_session);
  const history_ref = useRef(history_by_session);
  const mutation_batches_ref = useRef(new Map<string, SessionMutation[]>());
  const mutation_frame_ref = useRef<number | null>(null);
  const snapshot_request_ref = useRef(new Map<string, number>());
  const deleting_session_keys_ref = useRef(new Set<string>());
  const deleted_session_keys_ref = useRef(new Set<string>());
  const processing_queue_ref = useRef(new Set<string>());
  const hydrated_navigation_keys_ref = useRef(new Set<string>());
  const active_group_session_ids_ref = useRef(new Map<string, string>());
  const previous_selection_ref = useRef<NavigationTarget | null>(null);
  const selection_by_sidebar_mode_ref = useRef<Partial<Record<SidebarMode, NavigationTarget>>>({});

  useEffect(() => { chat_runtime_ref.current = chat_runtime_by_session; }, [chat_runtime_by_session]);
  useEffect(() => { queue_ref.current = queued_messages_by_session; }, [queued_messages_by_session]);
  useEffect(() => { queue_paused_ref.current = queue_paused_by_session; }, [queue_paused_by_session]);
  useEffect(() => { history_ref.current = history_by_session; }, [history_by_session]);
  useEffect(() => {
    let active = true;
    const commit_notification_state = (next: DesktopNotificationState) => {
      if (!active) return;
      set_notification_state((current) => next.revision >= current.revision ? next : current);
    };
    const unsubscribe = window.downcity.notification.subscribe(commit_notification_state);
    void window.downcity.notification.get_state().then(commit_notification_state).catch((reason) => {
      if (active) set_error(to_error_message(reason));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  /** 向主进程报告当前实际可见的通知目标，由 Notification 统一完成已读收口。 */
  useEffect(() => {
    const report_view_state = () => {
      const target = notification_target_from_navigation(selection, plugin_routes);
      void window.downcity.notification.set_view_state({
        ...(target ? { target } : {}),
        visible: Boolean(target && document.visibilityState === "visible" && document.hasFocus()),
      }).catch(() => undefined);
    };
    report_view_state();
    document.addEventListener("visibilitychange", report_view_state);
    window.addEventListener("focus", report_view_state);
    window.addEventListener("blur", report_view_state);
    return () => {
      document.removeEventListener("visibilitychange", report_view_state);
      window.removeEventListener("focus", report_view_state);
      window.removeEventListener("blur", report_view_state);
      void window.downcity.notification.set_view_state({ visible: false }).catch(() => undefined);
    };
  }, [plugin_routes, selection]);
  useEffect(() => {
    if (!selection) return;
    const target_mode = get_sidebar_mode_for_target(selection);
    if (target_mode) selection_by_sidebar_mode_ref.current[target_mode] = selection;
    if (is_restorable_navigation_target(selection)) {
      localStorage.setItem(desktop_navigation_storage_key, JSON.stringify(selection));
    }
  }, [selection]);

  /** 保存队列并同步异步回调读取的引用。 */
  const commit_queue = useCallback((next: Record<string, QueuedChatMessage[]>) => {
    queue_ref.current = next;
    set_queued_messages_by_session(next);
  }, []);

  /** 提交队首消息；同一 Session 同时只执行一个提交循环。 */
  const process_next_queue = useCallback(async (workspace_id: string, agent_id: string, session_id: string): Promise<void> => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    if (deleting_session_keys_ref.current.has(session_key) || deleted_session_keys_ref.current.has(session_key) || processing_queue_ref.current.has(session_key) || queue_paused_ref.current[session_key] || is_chat_busy(chat_runtime_ref.current[session_key])) return;
    const queued = queue_ref.current[session_key]?.[0];
    if (!queued || queued.paused) return;
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
      if (deleted_session_keys_ref.current.has(session_key)) return;
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
      window.downcity.group.list(),
      window.downcity.settings.get(),
      window.downcity.settings.list_env(),
      window.downcity.plugin.list(),
    ]).then(async ([next_agents, next_workspaces, next_groups, next_settings, next_env, next_plugins]) => {
      set_agents(next_agents);
      set_workspaces(next_workspaces);
      set_groups(next_groups);
      set_groups_by_id(Object.fromEntries(next_groups.map((group) => [group.group_id, group])));
      set_group_sessions_by_workspace(index_group_sessions(next_groups));
      set_settings(next_settings);
      set_global_env(normalize_global_env_text(next_env));
      set_plugins(next_plugins);
      const stored_target = parse_navigation_target(localStorage.getItem(desktop_navigation_storage_key));
      const can_restore_session = stored_target?.kind === "session"
        && next_agents.some((agent) => agent.agent_id === stored_target.agent_id)
        && next_workspaces.some((workspace) => workspace.workspace_id === stored_target.workspace_id);
      const restored_session_entries = can_restore_session
        ? await window.downcity.chat.list_sessions(stored_target.agent_id, stored_target.workspace_id)
        : [];
      const initial_sessions_by_workspace = can_restore_session
        ? { [stored_target.workspace_id]: restored_session_entries.map((session) => ({ agent_id: stored_target.agent_id, session })) }
        : {};
      if (restored_session_entries.length > 0) set_sessions_by_workspace(initial_sessions_by_workspace);
      const initial_agent = next_agents.find((agent) => agent.agent_id === next_settings.default_agent_id) ?? next_agents[0];
      const stored_workspace_id = localStorage.getItem(active_workspace_storage_key) || "";
      const initial_workspace = next_workspaces.find((workspace) => workspace.workspace_id === stored_workspace_id)
        ?? next_workspaces[0];
      if (initial_workspace) {
        set_active_workspace_id(initial_workspace.workspace_id);
        localStorage.setItem(active_workspace_storage_key, initial_workspace.workspace_id);
      }
      const restored_target = stored_target ? resolve_navigation_target(stored_target, {
        agents: next_agents,
        workspaces: next_workspaces,
        groups: next_groups,
        plugins: next_plugins,
        sessions_by_workspace: initial_sessions_by_workspace,
      }, initial_workspace?.workspace_id) : undefined;
      if (restored_target) {
        if ("workspace_id" in restored_target) {
          set_active_workspace_id(restored_target.workspace_id);
          localStorage.setItem(active_workspace_storage_key, restored_target.workspace_id);
        }
        set_sidebar_mode_state(get_sidebar_mode_for_navigation(restored_target));
        set_selection(restored_target);
      } else if (initial_agent && initial_workspace && next_settings.open_empty_chat_on_start) {
        set_selection({ kind: "draft", workspace_id: initial_workspace.workspace_id, agent_id: initial_agent.agent_id, draft_id: get_draft_session_id(initial_agent.agent_id) });
      } else if (initial_workspace) {
        set_sidebar_mode_state("workspace");
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
    const unsubscribe = window.downcity.group.subscribe((event) => {
      if (event.type === "title") {
        set_groups((current) => current.map((group) => update_group_session_title(group, event.group_id, event.session_id, event.title)));
        set_groups_by_id((current) => current[event.group_id]
          ? { ...current, [event.group_id]: update_group_session_title(current[event.group_id], event.group_id, event.session_id, event.title) }
          : current);
        set_group_sessions_by_workspace((current) => update_group_session_title_index(current, event.group_id, event.session_id, event.title));
        return;
      }
      const active_session_id = active_group_session_ids_ref.current.get(event.group_id);
      if (!active_session_id || active_session_id !== event.session_id) return;
      if (event.type === "interaction") {
        set_group_interactions_by_group((current) => ({ ...current, [event.group_id]: [...(current[event.group_id] ?? []).filter((item) => item.part.interaction_id !== event.request.interaction_id), { agent_id: event.agent_id, part: { part_id: `group-interaction:${event.request.interaction_id}`, sequence: 1, type: "interaction", interaction_id: event.request.interaction_id, interaction_type: event.request.type, status: "pending", request: event.request } }] }));
        return;
      }
      if (event.type === "status") {
        const { group_id, members } = event;
        set_group_member_statuses_by_group((current) => ({ ...current, [group_id]: members.filter((status) => status.running) }));
        set_group_phase_by_group((current) => ({ ...current, [group_id]: event.phase }));
        if (event.phase === "dispatched" && event.dispatched_member_ids) {
          if (event.message_id) {
            set_group_read_message_ids_by_group((current) => ({
              ...current,
              [group_id]: [...new Set([...(current[group_id] ?? []), event.message_id!])],
            }));
          }
        }
        return;
      }
      const { group_id, message } = event;
      set_group_messages_by_group((current) => ({
        ...current,
        [group_id]: [...(current[group_id] ?? []), message],
      }));
      set_groups_by_id((current) => current[group_id]
        ? { ...current, [group_id]: { ...current[group_id], message_count: current[group_id].message_count + 1 } }
        : current);
    });
    return unsubscribe;
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
      if (deleted_session_keys_ref.current.has(session_key)) return;
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
      if (deleted_session_keys_ref.current.has(session_key)) return;
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

  const select_plugin = useCallback((plugin_id: string) => {
    set_error("");
    set_sidebar_mode_state("plugins");
    set_selection({ kind: "plugin", plugin_id });
  }, []);

  const select_plugins = useCallback(() => {
    set_error("");
    set_sidebar_mode_state("plugins");
    set_selection({ kind: "plugins" });
  }, []);

  const select_plugin_workspace = useCallback((plugin_id: string) => {
    const plugin = plugins.find((item) => item.plugin_id === plugin_id);
    if (!plugin?.has_sidebar || !plugin.has_mainview) return;
    set_error("");
    set_sidebar_mode_state(plugin_workspace_mode(plugin_id));
    set_selection({ kind: "plugin_workspace", plugin_id });
  }, [plugins]);

  const navigate_plugin = useCallback((plugin_id: string, route: import("@downcity/plugin").PluginJsonObject) => {
    set_plugin_routes((current) => ({ ...current, [plugin_id]: structuredClone(route) }));
  }, []);

  const invalidate_plugin = useCallback((plugin_id: string) => {
    set_plugin_revisions((current) => ({ ...current, [plugin_id]: (current[plugin_id] ?? 0) + 1 }));
  }, []);

  const set_sidebar_mode = useCallback((mode: SidebarMode) => {
    set_sidebar_mode_state(mode);
    const remembered_selection = selection_by_sidebar_mode_ref.current[mode];
    if (remembered_selection) {
      set_selection(remembered_selection);
      return;
    }
    if (mode === "workspace") {
      const workspace = workspaces.find((item) => item.workspace_id === active_workspace_id) ?? workspaces[0];
      set_selection(workspace ? { kind: "workspace", workspace_id: workspace.workspace_id } : null);
      return;
    }
    if (mode === "plugins") {
      set_selection({ kind: "plugins" });
      return;
    }
    const plugin_id = plugin_id_from_sidebar_mode(mode);
    const plugin = plugin_id ? plugins.find((item) => item.plugin_id === plugin_id) : undefined;
    if (plugin?.has_sidebar && plugin.has_mainview) {
      set_selection({ kind: "plugin_workspace", plugin_id: plugin.plugin_id });
      return;
    }
    set_selection(agents[0] ? { kind: "agent", agent_id: agents[0].agent_id } : null);
  }, [active_workspace_id, agents, plugins, workspaces]);

  const select_workspace = useCallback((workspace_id: string) => {
    if (!workspaces.some((workspace) => workspace.workspace_id === workspace_id)) return;
    set_error("");
    set_sidebar_mode_state("workspace");
    set_active_workspace_id(workspace_id);
    localStorage.setItem(active_workspace_storage_key, workspace_id);
    set_selection({ kind: "workspace", workspace_id });
  }, [workspaces]);

  const select_workspace_file = useCallback((workspace_id: string, relative_path: string) => {
    if (!workspaces.some((workspace) => workspace.workspace_id === workspace_id)) return;
    set_error("");
    set_sidebar_mode_state("workspace");
    set_active_workspace_id(workspace_id);
    localStorage.setItem(active_workspace_storage_key, workspace_id);
    set_selection({ kind: "workspace_file", workspace_id, relative_path });
  }, [workspaces]);

  const create_group = useCallback(async (input: DesktopCreateGroupInput) => {
    set_error("");
    try {
      const group = await window.downcity.group.create(input);
      set_groups((current) => [...current, group]);
      set_groups_by_id((current) => ({ ...current, [group.group_id]: group }));
      set_group_sessions_by_workspace((current) => merge_group_sessions(current, group));
      set_sidebar_mode_state("chat");
      set_selection({ kind: "group", group_id: group.group_id });
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, []);

  const open_create_group = useCallback(() => {
    set_error("");
    set_sidebar_mode_state("chat");
    set_selection({ kind: "create_group" });
  }, []);

  const update_group = useCallback(async (group_id: string, input: DesktopUpdateGroupInput) => {
    set_error("");
    try {
      const group = await window.downcity.group.update(group_id, input);
      set_groups((current) => current.map((item) => item.group_id === group.group_id ? group : item));
      set_groups_by_id((current) => ({ ...current, [group_id]: group }));
      set_group_sessions_by_workspace((current) => replace_group_sessions(current, group));
      set_group_messages_by_group((current) => ({ ...current, [group_id]: [] }));
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, []);

  const remove_group = useCallback(async (group_id: string) => {
    set_error("");
    try {
      await window.downcity.group.remove(group_id);
      set_groups((current) => current.filter((item) => item.group_id !== group_id));
      set_groups_by_id((current) => { const next = { ...current }; delete next[group_id]; return next; });
      set_group_sessions_by_workspace((current) => remove_group_sessions(current, group_id));
      set_group_messages_by_group((current) => { const next = { ...current }; delete next[group_id]; return next; });
      set_group_member_statuses_by_group((current) => { const next = { ...current }; delete next[group_id]; return next; });
      set_group_phase_by_group((current) => { const next = { ...current }; delete next[group_id]; return next; });
      set_group_read_message_ids_by_group((current) => { const next = { ...current }; delete next[group_id]; return next; });
      active_group_session_ids_ref.current.delete(group_id);
      if ((selection?.kind === "group_session" || selection?.kind === "group_draft") && selection.group_id === group_id) set_selection(null);
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, [selection]);

  /** 解析 Chat 当前应使用的 Workspace，并确保它进入 Renderer 目录。 */
  const resolve_chat_workspace = useCallback(async (preferred_workspace_id?: string) => {
    const target_workspace = workspaces.find((workspace) => workspace.workspace_id === preferred_workspace_id)
      ?? workspaces.find((workspace) => workspace.workspace_id === active_workspace_id)
      ?? workspaces[0]
      ?? await window.downcity.workspace.get_default();
    if (!workspaces.some((workspace) => workspace.workspace_id === target_workspace.workspace_id)) {
      set_workspaces((current) => [...current, target_workspace]);
    }
    return target_workspace;
  }, [active_workspace_id, workspaces]);

  /** 打开 Group 的本地 Draft；此阶段不创建任何持久化 GroupSession。 */
  const open_group_draft = useCallback(async (group_id: string, workspace_id?: string) => {
    const workspace = await resolve_chat_workspace(workspace_id);
    const draft_id = get_group_draft_session_id(group_id);
    active_group_session_ids_ref.current.delete(group_id);
    set_sidebar_mode_state("chat");
    set_group_messages_by_group((current) => ({ ...current, [group_id]: [] }));
    set_group_member_statuses_by_group((current) => ({ ...current, [group_id]: [] }));
    set_group_phase_by_group((current) => ({ ...current, [group_id]: "idle" }));
    set_group_read_message_ids_by_group((current) => ({ ...current, [group_id]: [] }));
    set_group_interactions_by_group((current) => ({ ...current, [group_id]: [] }));
    set_active_workspace_id(workspace.workspace_id);
    localStorage.setItem(active_workspace_storage_key, workspace.workspace_id);
    set_selection({ kind: "group_draft", group_id, workspace_id: workspace.workspace_id, draft_id });
  }, [resolve_chat_workspace]);

  const open_group = useCallback(async (group_id: string, session_id?: string) => {
    set_error("");
    if (session_id) hydrated_navigation_keys_ref.current.add(`group:${group_id}:${session_id}`);
    try {
      let target_session_id = session_id;
      const summaries = await window.downcity.group.list_sessions(group_id);
      if (!target_session_id) {
        target_session_id = summaries.slice().sort((left, right) => right.updated_at - left.updated_at)[0]?.session_id;
      }
      if (!target_session_id) {
        await open_group_draft(group_id);
        return;
      }
      const group = await window.downcity.group.open(group_id, target_session_id);
      set_groups_by_id((current) => ({ ...current, [group_id]: group }));
      set_groups((current) => current.map((item) => item.group_id === group_id ? group : item));
      set_group_sessions_by_workspace((current) => replace_group_sessions(current, group));
      const active_session = group.sessions.find((item) => item.session_id === group.active_session_id);
      if (!active_session?.workspace_id || !group.active_session_id) throw new Error("GroupSession 必须绑定 Workspace");
      active_group_session_ids_ref.current.set(group_id, group.active_session_id);
      const messages = await window.downcity.group.list_messages(group_id, group.active_session_id);
      set_group_messages_by_group((current) => ({ ...current, [group.group_id]: messages }));
      // 切换 GroupSession 后，旧 Session 的运行态和已读标记不能带入新上下文。
      set_group_member_statuses_by_group((current) => ({ ...current, [group.group_id]: [] }));
      set_group_phase_by_group((current) => ({ ...current, [group.group_id]: "idle" }));
      set_group_read_message_ids_by_group((current) => ({ ...current, [group.group_id]: [] }));
      set_group_interactions_by_group((current) => ({ ...current, [group.group_id]: [] }));
      set_active_workspace_id(active_session.workspace_id);
      localStorage.setItem(active_workspace_storage_key, active_session.workspace_id);
      set_selection({ kind: "group_session", group_id, workspace_id: active_session.workspace_id, session_id: group.active_session_id });
    } catch (reason) {
      set_error(to_error_message(reason));
    }
  }, [open_group_draft]);

  /** 刷新恢复 GroupSession 时，通过既有打开入口补齐消息与运行上下文。 */
  useEffect(() => {
    if (selection?.kind !== "group_session") return;
    const navigation_key = `group:${selection.group_id}:${selection.session_id}`;
    if (hydrated_navigation_keys_ref.current.has(navigation_key)) return;
    hydrated_navigation_keys_ref.current.add(navigation_key);
    void open_group(selection.group_id, selection.session_id);
  }, [open_group, selection]);

  const create_group_session = useCallback(async (group_id: string, workspace_id?: string) => {
    set_error("");
    try {
      await open_group_draft(group_id, workspace_id);
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, [open_group_draft]);

  /** 将当前 Group 草稿移动到目标 Workspace，并保持它仍处于未持久化状态。 */
  const switch_group_draft_context = useCallback(async (group_id: string, workspace_id: string) => {
    if (selection?.kind !== "group_draft" || selection.group_id !== group_id || selection.workspace_id === workspace_id) return;
    const source_key = get_group_chat_key(selection.workspace_id, group_id, selection.draft_id);
    const target_key = get_group_chat_key(workspace_id, group_id, selection.draft_id);
    set_draft_content_by_session((current) => move_draft_value(current, source_key, target_key, create_chat_composer()));
    await open_group_draft(group_id, workspace_id);
  }, [open_group_draft, selection]);

  /** 修改 GroupSession 标题，并立即更新本地导航投影。 */
  const rename_group_session = useCallback(async (group_id: string, session_id: string, title: string) => {
    try {
      const normalized_title = await window.downcity.group.rename_session(group_id, session_id, title);
      set_groups((current) => current.map((group) => update_group_session_title(group, group_id, session_id, normalized_title)));
      set_groups_by_id((current) => current[group_id]
        ? { ...current, [group_id]: update_group_session_title(current[group_id], group_id, session_id, normalized_title) }
        : current);
      set_group_sessions_by_workspace((current) => update_group_session_title_index(current, group_id, session_id, normalized_title));
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, []);

  const remove_group_session = useCallback(async (group_id: string, session_id: string) => {
    set_error("");
    try {
      const group = await window.downcity.group.remove_session(group_id, session_id);
      set_groups((current) => current.map((item) => item.group_id === group.group_id ? group : item));
      set_groups_by_id((current) => ({ ...current, [group.group_id]: group }));
      set_group_sessions_by_workspace((current) => replace_group_sessions(current, group));
      set_group_messages_by_group((current) => ({ ...current, [group.group_id]: [] }));
      set_group_member_statuses_by_group((current) => ({ ...current, [group.group_id]: [] }));
      set_group_phase_by_group((current) => ({ ...current, [group.group_id]: "idle" }));
      set_group_read_message_ids_by_group((current) => ({ ...current, [group.group_id]: [] }));
      const next_session = group.sessions.find((session) => session.session_id === group.active_session_id);
      const was_default = settings.group_main_sessions[group_id]?.session_id === session_id;
      if (was_default) {
        const next_group_main_sessions = { ...settings.group_main_sessions };
        delete next_group_main_sessions[group_id];
        set_settings(await window.downcity.settings.update({ group_main_sessions: next_group_main_sessions }));
      }
      if (selection?.kind === "group_session" && selection.group_id === group_id && selection.session_id === session_id) {
        if (next_session?.workspace_id && group.active_session_id) await open_group(group.group_id, group.active_session_id);
        else await open_group_draft(group_id, selection.workspace_id);
      }
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, [open_group, open_group_draft, selection, settings.group_main_sessions]);

  const send_group_message = useCallback(async (group_id: string, workspace_id: string, session_id: string, input: JSONContent) => {
    const normalized_text = read_chat_composer_text(input, true);
    if (!normalized_text) return undefined;
    set_error("");
    const source_key = get_group_chat_key(workspace_id, group_id, session_id);
    let target_key = source_key;
    set_draft_content_by_session((current) => remove_session_value(current, source_key));
    // 调度器尚未选出成员前，不展示上一轮遗留的输入状态。
    set_group_member_statuses_by_group((current) => ({ ...current, [group_id]: [] }));
    try {
      let target_session_id = session_id;
      if (is_group_draft_session_id(session_id)) {
        const group = await window.downcity.group.create_session(group_id, workspace_id);
        const created_session = group.sessions.find((item) => item.session_id === group.active_session_id);
        if (!group.active_session_id || created_session?.workspace_id !== workspace_id) {
          throw new Error("无法创建当前 Workspace 的 GroupSession");
        }
        target_session_id = group.active_session_id;
        target_key = get_group_chat_key(workspace_id, group_id, target_session_id);
        active_group_session_ids_ref.current.set(group_id, target_session_id);
        set_groups((current) => current.map((item) => item.group_id === group.group_id ? group : item));
        set_groups_by_id((current) => ({ ...current, [group.group_id]: group }));
        set_group_sessions_by_workspace((current) => replace_group_sessions(current, group));
        set_group_messages_by_group((current) => ({ ...current, [group.group_id]: [] }));
        set_group_phase_by_group((current) => ({ ...current, [group.group_id]: "idle" }));
        set_group_read_message_ids_by_group((current) => ({ ...current, [group.group_id]: [] }));
        set_group_interactions_by_group((current) => ({ ...current, [group.group_id]: [] }));
        hydrated_navigation_keys_ref.current.add(`group:${group_id}:${target_session_id}`);
        set_selection({ kind: "group_session", group_id, workspace_id, session_id: target_session_id });
      }
      const result = await window.downcity.group.send(group_id, target_session_id, { text: normalized_text });
      return result.turn_id;
    } catch (reason) {
      set_draft_content_by_session((current) => ({ ...current, [target_key]: input }));
      set_error(to_error_message(reason));
      return undefined;
    }
  }, []);

  /** 按 Workspace、Group 和 Session 隔离更新完整群聊草稿。 */
  const update_group_draft = useCallback((workspace_id: string, group_id: string, session_id: string, input: JSONContent) => {
    set_draft_content_by_session((current) => ({
      ...current,
      [get_group_chat_key(workspace_id, group_id, session_id)]: input,
    }));
  }, []);

  const stop_group = useCallback(async (group_id: string, session_id: string) => {
    set_error("");
    try {
      await window.downcity.group.stop(group_id, session_id);
    } catch (reason) {
      set_error(to_error_message(reason));
    }
  }, []);

  const respond_group_interaction = useCallback(async (group_id: string, session_id: string, input: RespondSessionInteractionInput) => {
    await window.downcity.group.respond_interaction(group_id, session_id, input);
    set_group_interactions_by_group((current) => ({ ...current, [group_id]: (current[group_id] ?? []).filter((item) => item.part.interaction_id !== input.interaction_id) }));
  }, []);

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

  /** 将当前 Draft 的全部编辑状态移动到新的 Workspace 与 Agent。 */
  const switch_draft_context = useCallback((workspace_id: string, agent_id: string) => {
    if (selection?.kind !== "draft") return;
    const source_key = get_session_key(selection.workspace_id, selection.agent_id, selection.draft_id);
    const draft_id = get_draft_session_id(agent_id);
    const target_key = get_session_key(workspace_id, agent_id, draft_id);
    if (source_key === target_key) return;

    set_draft_content_by_session((current) => move_draft_value(current, source_key, target_key, create_chat_composer()));
    set_configuration_by_session((current) => {
      const agent = agents.find((item) => item.agent_id === agent_id);
      return move_draft_value(current, source_key, target_key, {
        model_id: settings.default_text_model_id || agent?.model_id || "",
        approval_mode: "ask",
      });
    });
    set_active_workspace_id(workspace_id);
    localStorage.setItem(active_workspace_storage_key, workspace_id);
    set_selection({ kind: "draft", workspace_id, agent_id, draft_id });
  }, [agents, selection, settings.default_text_model_id]);

  const select_session = useCallback(async (workspace_id: string, agent_id: string, session_id: string, preserve_sidebar = false) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    if (deleting_session_keys_ref.current.has(session_key) || deleted_session_keys_ref.current.has(session_key)) return;
    hydrated_navigation_keys_ref.current.add(`session:${session_key}`);
    set_error("");
    if (!preserve_sidebar) set_sidebar_mode_state("chat");
    set_active_workspace_id(workspace_id);
    set_selection({ kind: "session", workspace_id, agent_id, session_id });
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
      if (deleting_session_keys_ref.current.has(session_key) || deleted_session_keys_ref.current.has(session_key) || snapshot_request_ref.current.get(session_key) !== request_id) return;
      set_error(to_error_message(reason));
    }
  }, []);

  /** 刷新恢复 Session 时，通过既有快照入口补齐消息、配置与运行态。 */
  useEffect(() => {
    if (selection?.kind !== "session") return;
    const session_key = get_session_key(selection.workspace_id, selection.agent_id, selection.session_id);
    const navigation_key = `session:${session_key}`;
    if (hydrated_navigation_keys_ref.current.has(navigation_key)) return;
    hydrated_navigation_keys_ref.current.add(navigation_key);
    void select_session(selection.workspace_id, selection.agent_id, selection.session_id, true);
  }, [select_session, selection]);

  /** 刷新当前 Agent Session 的 canonical 快照，恢复窗口切换期间错过的 mutation。 */
  const refresh_session_snapshot = useCallback(async (workspace_id: string, agent_id: string, session_id: string): Promise<void> => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    if (deleting_session_keys_ref.current.has(session_key) || deleted_session_keys_ref.current.has(session_key)) return;
    const request_id = (snapshot_request_ref.current.get(session_key) ?? 0) + 1;
    snapshot_request_ref.current.set(session_key, request_id);
    try {
      const [snapshot, configuration] = await Promise.all([
        window.downcity.chat.get_snapshot(agent_id, workspace_id, session_id),
        window.downcity.chat.get_configuration(agent_id, workspace_id, session_id),
      ]);
      if (deleting_session_keys_ref.current.has(session_key) || deleted_session_keys_ref.current.has(session_key) || snapshot_request_ref.current.get(session_key) !== request_id) return;
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
      if (deleting_session_keys_ref.current.has(session_key) || deleted_session_keys_ref.current.has(session_key) || snapshot_request_ref.current.get(session_key) !== request_id) return;
      set_error(to_error_message(reason));
    }
  }, []);

  /** 窗口重新可见或获得焦点时同步当前 Session，避免漏掉后台期间的交互事件。 */
  useEffect(() => {
    const refresh_current_session = () => {
      if (document.visibilityState === "hidden") return;
      const current = selection;
      if (current?.kind === "session") void refresh_session_snapshot(current.workspace_id, current.agent_id, current.session_id);
    };
    document.addEventListener("visibilitychange", refresh_current_session);
    window.addEventListener("focus", refresh_current_session);
    return () => {
      document.removeEventListener("visibilitychange", refresh_current_session);
      window.removeEventListener("focus", refresh_current_session);
    };
  }, [refresh_session_snapshot, selection]);

  /** 打开 Agent 最近更新的 Session；没有历史时进入未持久化的新对话。 */
  const open_agent_chat = useCallback(async (agent_id: string) => {
    set_error("");
    try {
      const latest_session = Object.entries(sessions_by_workspace)
        .flatMap(([workspace_id, entries]) => entries.filter((entry) => entry.agent_id === agent_id).map((entry) => ({ workspace_id, session: entry.session })))
        .sort((left, right) => right.session.updated_at - left.session.updated_at)[0];
      if (latest_session) {
        await select_session(latest_session.workspace_id, agent_id, latest_session.session.session_id, true);
        return;
      }
      const target_workspace = workspaces.find((workspace) => workspace.workspace_id === active_workspace_id)
        ?? workspaces[0]
        ?? await window.downcity.workspace.get_default();
      const workspace_id = target_workspace.workspace_id;
      if (!workspaces.some((workspace) => workspace.workspace_id === workspace_id)) {
        set_workspaces((current) => [...current, target_workspace]);
      }
      await create_session(workspace_id, agent_id);
    } catch (reason) {
      set_error(to_error_message(reason));
    }
  }, [active_workspace_id, create_session, select_session, sessions_by_workspace, workspaces]);

  const select_agent = useCallback((agent_id: string) => {
    set_error("");
    set_selection({ kind: "agent", agent_id });
  }, []);

  const open_create_agent = useCallback(() => {
    set_error("");
    set_sidebar_mode_state("chat");
    set_selection({ kind: "create_agent" });
  }, []);

  const select_group = useCallback((group_id: string) => {
    set_error("");
    set_selection({ kind: "group", group_id });
  }, []);

  /** 创建分支 Session，将其加入导航列表并立即打开。 */
  const fork_session = useCallback(async (workspace_id: string, agent_id: string, session_id: string, message_id: string) => {
    set_error("");
    try {
      const session = await window.downcity.chat.fork_session(agent_id, workspace_id, session_id, message_id);
      set_sessions_by_workspace((current) => ({
        ...current,
        [workspace_id]: [{ agent_id, session }, ...(current[workspace_id] ?? []).filter((item) => item.agent_id !== agent_id || item.session.session_id !== session.session_id)],
      }));
      await select_session(workspace_id, agent_id, session.session_id);
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, [select_session]);

  /** 重写历史用户消息，并将承载新 Turn 的 Session 设为当前会话。 */
  const rewrite_session_message = useCallback(async (workspace_id: string, agent_id: string, session_id: string, input: DesktopChatRewriteInput) => {
    set_error("");
    try {
      const result = await window.downcity.chat.rewrite_session_message(agent_id, workspace_id, session_id, input);
      set_sessions_by_workspace((current) => ({
        ...current,
        [workspace_id]: [
          { agent_id, session: result.session },
          ...(current[workspace_id] ?? []).filter((item) => {
            if (item.agent_id !== agent_id) return true;
            if (item.session.session_id === result.session.session_id) return false;
            return input.action !== "rollback" || item.session.session_id !== session_id;
          }),
        ],
      }));
      await select_session(workspace_id, agent_id, result.session.session_id);
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, [select_session]);

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
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    deleting_session_keys_ref.current.add(session_key);
    snapshot_request_ref.current.set(session_key, (snapshot_request_ref.current.get(session_key) ?? 0) + 1);
    try {
      await window.downcity.chat.remove_session(agent_id, workspace_id, session_id);
      deleting_session_keys_ref.current.delete(session_key);
      deleted_session_keys_ref.current.add(session_key);
      set_sessions_by_workspace((current) => ({
        ...current,
        [workspace_id]: (current[workspace_id] ?? []).filter((item) => item.agent_id !== agent_id || item.session.session_id !== session_id),
      }));
      set_messages_by_session((current) => remove_session_value(current, session_key));
      chat_runtime_ref.current = remove_session_value(chat_runtime_ref.current, session_key);
      set_chat_runtime_by_session(chat_runtime_ref.current);
      history_ref.current = remove_session_value(history_ref.current, session_key);
      set_history_by_session(history_ref.current);
      set_configuration_by_session((current) => remove_session_value(current, session_key));
      set_draft_content_by_session((current) => remove_session_value(current, session_key));
      commit_queue(remove_session_value(queue_ref.current, session_key));
      processing_queue_ref.current.delete(session_key);
      mutation_batches_ref.current.delete(session_key);
      snapshot_request_ref.current.delete(session_key);
      const fallback_selection: NavigationTarget = { kind: "draft", workspace_id, agent_id, draft_id: get_draft_session_id(agent_id) };
      if (previous_selection_ref.current?.kind === "session" && previous_selection_ref.current.workspace_id === workspace_id && previous_selection_ref.current.agent_id === agent_id && previous_selection_ref.current.session_id === session_id) {
        previous_selection_ref.current = fallback_selection;
      }
      for (const mode of Object.keys(selection_by_sidebar_mode_ref.current) as SidebarMode[]) {
        const target = selection_by_sidebar_mode_ref.current[mode];
        if (target?.kind === "session" && target.workspace_id === workspace_id && target.agent_id === agent_id && target.session_id === session_id) {
          selection_by_sidebar_mode_ref.current[mode] = fallback_selection;
        }
      }
      set_selection((current) => current?.kind === "session" && current.workspace_id === workspace_id && current.agent_id === agent_id && current.session_id === session_id
        ? fallback_selection
        : current);
    } catch (reason) {
      deleting_session_keys_ref.current.delete(session_key);
      set_error(to_error_message(reason));
      throw reason;
    }
  }, [commit_queue]);

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
    const result = await window.downcity.agent.create(value);
    set_agents((current) => [...current.filter((item) => item.agent_id !== result.agent.agent_id), result.agent]);
    set_sidebar_mode_state("chat");
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

  const remove_agent = useCallback(async (agent_id: string) => {
    set_error("");
    try {
      const removed = await window.downcity.agent.remove(agent_id);
      if (!removed) return;
      set_agents((current) => {
        const next = current.filter((agent) => agent.agent_id !== agent_id);
        set_selection((selection) => selection && "agent_id" in selection && selection.agent_id === agent_id
          ? (next[0] ? { kind: "agent", agent_id: next[0].agent_id } : null)
          : selection);
        return next;
      });
      set_sessions_by_workspace((current) => Object.fromEntries(Object.entries(current).map(([workspace_id, sessions]) => [workspace_id, sessions.filter((session) => session.agent_id !== agent_id)])));
      set_archived_sessions_by_workspace((current) => Object.fromEntries(Object.entries(current).map(([workspace_id, sessions]) => [workspace_id, sessions.filter((session) => session.agent_id !== agent_id)])));
      set_plugins(await window.downcity.plugin.list());
      const next_settings = {
        default_agent_id: settings.default_agent_id === agent_id ? "" : settings.default_agent_id,
        agent_main_sessions: Object.fromEntries(Object.entries(settings.agent_main_sessions).filter(([current_agent_id]) => current_agent_id !== agent_id)),
      };
      set_settings(await window.downcity.settings.update(next_settings));
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, [settings]);

  const choose_agent_avatar = useCallback(async (agent_id: string) => {
    set_error("");
    try {
      const agent = await window.downcity.agent.choose_avatar(agent_id);
      if (agent) set_agents((current) => current.map((item) => item.agent_id === agent.agent_id ? agent : item));
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, []);

  const remove_agent_avatar = useCallback(async (agent_id: string) => {
    set_error("");
    try {
      const agent = await window.downcity.agent.remove_avatar(agent_id);
      set_agents((current) => current.map((item) => item.agent_id === agent.agent_id ? agent : item));
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, []);

  const generate_agent_avatar = useCallback(async (agent_id: string) => {
    set_error("");
    try {
      const agent = await window.downcity.agent.generate_avatar(agent_id);
      set_agents((current) => current.map((item) => item.agent_id === agent.agent_id ? agent : item));
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, []);

  const get_plugin = useCallback(async (plugin_id: string) => {
    return await window.downcity.plugin.get(plugin_id);
  }, []);

  const create_plugin_profile = useCallback(async (plugin_id: string, input: Parameters<typeof window.downcity.plugin.create_profile>[1]) => {
    set_error("");
    try {
      const definition = await window.downcity.plugin.create_profile(plugin_id, input);
      set_plugins(await window.downcity.plugin.list());
      return definition;
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, []);

  const invoke_plugin_action = useCallback(async (plugin_id: string, input: Parameters<typeof window.downcity.plugin.invoke>[1]) => {
    set_error("");
    try {
      return await window.downcity.plugin.invoke(plugin_id, input);
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
    const workspace = await window.downcity.workspace.create(value);
    set_workspaces((current) => [...current.filter((item) => item.workspace_id !== workspace.workspace_id), workspace]);
    set_sidebar_mode_state("workspace");
    set_active_workspace_id(workspace.workspace_id);
    localStorage.setItem(active_workspace_storage_key, workspace.workspace_id);
    set_selection({ kind: "workspace", workspace_id: workspace.workspace_id });
  }, []);

  const update_workspace_name = useCallback(async (workspace_id: string, name: string) => {
    set_error("");
    const workspace = await window.downcity.workspace.update_name(workspace_id, name);
    set_workspaces((current) => current.map((item) => item.workspace_id === workspace_id ? workspace : item));
  }, []);

  const write_workspace_readme = useCallback(async (workspace_id: string, content: string) => {
    set_error("");
    const workspace = await window.downcity.workspace.write_readme(workspace_id, content);
    set_workspaces((current) => current.map((item) => item.workspace_id === workspace_id ? workspace : item));
  }, []);

  const remove_workspace = useCallback(async (workspace_id: string) => {
    set_error("");
    const normalized_workspace_id = String(workspace_id || "").trim();
    try {
      const removed = await window.downcity.workspace.remove(normalized_workspace_id);
      if (!removed) return;
      set_workspaces((current) => {
        const next = current.filter((item) => item.workspace_id !== normalized_workspace_id);
        const next_workspace = next[0];
        set_selection((selection) => {
          const targets_removed_workspace = (selection?.kind === "workspace" || selection?.kind === "workspace_file") && selection.workspace_id === normalized_workspace_id;
          if (!targets_removed_workspace) return selection;
          return next_workspace ? { kind: "workspace", workspace_id: next_workspace.workspace_id } : null;
        });
        return next;
      });
      const remove_workspace_key = <Value>(current: Record<string, Value>): Record<string, Value> => {
        const next = { ...current };
        delete next[normalized_workspace_id];
        return next;
      };
      const remove_prefixed_key = <Value>(current: Record<string, Value>): Record<string, Value> =>
        Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${normalized_workspace_id}:`)));
      set_sessions_by_workspace((current) => remove_workspace_key(current));
      set_archived_sessions_by_workspace((current) => remove_workspace_key(current));
      set_group_sessions_by_workspace((current) => remove_workspace_key(current));
      set_messages_by_session((current) => remove_prefixed_key(current));
      chat_runtime_ref.current = remove_prefixed_key(chat_runtime_ref.current);
      set_chat_runtime_by_session(chat_runtime_ref.current);
      history_ref.current = remove_prefixed_key(history_ref.current);
      set_history_by_session(history_ref.current);
      set_configuration_by_session((current) => remove_prefixed_key(current));
      set_draft_content_by_session((current) => remove_prefixed_key(current));
      commit_queue(remove_prefixed_key(queue_ref.current));
      set_queue_paused_by_session((current) => remove_prefixed_key(current));
      for (const key of [...snapshot_request_ref.current.keys()]) if (key.startsWith(`${normalized_workspace_id}:`)) snapshot_request_ref.current.delete(key);
      for (const key of [...deleting_session_keys_ref.current]) if (key.startsWith(`${normalized_workspace_id}:`)) deleting_session_keys_ref.current.delete(key);
      for (const key of [...deleted_session_keys_ref.current]) if (key.startsWith(`${normalized_workspace_id}:`)) deleted_session_keys_ref.current.delete(key);
      for (const key of [...processing_queue_ref.current]) if (key.startsWith(`${normalized_workspace_id}:`)) processing_queue_ref.current.delete(key);
      for (const key of [...mutation_batches_ref.current.keys()]) if (key.startsWith(`${normalized_workspace_id}:`)) mutation_batches_ref.current.delete(key);
      for (const key of [...hydrated_navigation_keys_ref.current]) if (key.startsWith(`${normalized_workspace_id}:`)) hydrated_navigation_keys_ref.current.delete(key);
      if (active_workspace_id === normalized_workspace_id) {
        const next_workspace = workspaces.find((item) => item.workspace_id !== normalized_workspace_id);
        if (next_workspace) {
          set_active_workspace_id(next_workspace.workspace_id);
          localStorage.setItem(active_workspace_storage_key, next_workspace.workspace_id);
        } else {
          set_active_workspace_id("");
          localStorage.removeItem(active_workspace_storage_key);
        }
      }
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, [active_workspace_id, commit_queue, workspaces]);

  const update_draft = useCallback((workspace_id: string, agent_id: string, session_id: string, input: JSONContent) => {
    set_draft_content_by_session((current) => ({
      ...current,
      [get_session_key(workspace_id, agent_id, session_id)]: input,
    }));
  }, []);

  const send_message = useCallback(async (workspace_id: string, agent_id: string, session_id: string, input: JSONContent, mode: ChatSubmitMode = "send") => {
    if (is_chat_composer_empty(input)) return;
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    set_error("");
    set_draft_content_by_session((current) => remove_session_value(current, session_key));
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
        await window.downcity.chat.send(agent_id, workspace_id, session.session_id, input);
        set_draft_content_by_session((current) => remove_session_value(current, actual_key));
      } catch (reason) {
        set_draft_content_by_session((current) => ({ ...current, [session_key]: input }));
        set_error(to_error_message(reason));
        throw reason;
      }
      return;
    }
    if (mode === "queue" || is_chat_busy(chat_runtime_ref.current[session_key]) || (queue_ref.current[session_key]?.length ?? 0) > 0) {
      const queued: QueuedChatMessage = {
        message_id: crypto.randomUUID(),
        input,
        created_at: Date.now(),
        sending: false,
        paused: mode === "queue",
      };
      commit_queue({ ...queue_ref.current, [session_key]: [...(queue_ref.current[session_key] ?? []), queued] });
      if (!is_chat_busy(chat_runtime_ref.current[session_key])) void process_next_queue(workspace_id, agent_id, session_id);
      return;
    }
    try {
      await window.downcity.chat.send(agent_id, workspace_id, session_id, input);
    } catch (reason) {
      set_draft_content_by_session((current) => ({ ...current, [session_key]: input }));
      set_error(to_error_message(reason));
    }
  }, [agents, commit_queue, configuration_by_session, process_next_queue, settings.default_text_model_id]);

  const compact_session = useCallback(async (workspace_id: string, agent_id: string, session_id: string) => {
    if (is_draft_session_id(session_id)) return;
    set_error("");
    try {
      await window.downcity.chat.compact_session(agent_id, workspace_id, session_id);
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
    }
  }, []);

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
        const selected_model = models.find((item) => item.model_id === model_id);
        const efforts = selected_model?.reasoning?.efforts ?? [];
        const reasoning_effort = efforts.find((item) => item.id === current.reasoning_effort)?.id
          || efforts.find((item) => item.id === selected_model?.reasoning?.default_effort)?.id
          || efforts[0]?.id;
        const { reasoning_effort: _old_reasoning_effort, ...base_configuration } = current;
        set_configuration_by_session((values) => ({ ...values, [session_key]: { ...base_configuration, model_id, ...(reasoning_effort ? { reasoning_effort } : {}) } }));
        return;
      }
      const configuration = await window.downcity.chat.set_model(agent_id, workspace_id, session_id, model_id);
      set_configuration_by_session((current) => ({ ...current, [session_key]: configuration }));
    } catch (reason) {
      set_error(to_error_message(reason));
    }
  }, [configuration_by_session, models]);

  const set_session_reasoning_effort = useCallback(async (workspace_id: string, agent_id: string, session_id: string, reasoning_effort?: string) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    try {
      if (is_draft_session_id(session_id)) {
        const current = configuration_by_session[session_key] ?? { model_id: agents.find((item) => item.agent_id === agent_id)?.model_id || "", approval_mode: "ask" as const };
        const { reasoning_effort: _old_reasoning_effort, ...base_configuration } = current;
        set_configuration_by_session((values) => ({ ...values, [session_key]: { ...base_configuration, ...(reasoning_effort ? { reasoning_effort } : {}) } }));
        return;
      }
      const configuration = await window.downcity.chat.set_reasoning_effort(agent_id, workspace_id, session_id, reasoning_effort);
      set_configuration_by_session((current) => ({ ...current, [session_key]: configuration }));
    } catch (reason) {
      set_error(to_error_message(reason));
    }
  }, [agents, configuration_by_session]);

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

  const send_queued_message = useCallback(async (workspace_id: string, agent_id: string, session_id: string, message_id: string) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    const queued = queue_ref.current[session_key]?.find((item) => item.message_id === message_id);
    if (!queued || queued.sending) return;
    commit_queue({
      ...queue_ref.current,
      [session_key]: (queue_ref.current[session_key] ?? []).map((item) => item.message_id === message_id ? { ...item, sending: true } : item),
    });
    try {
      await window.downcity.chat.send(agent_id, workspace_id, session_id, queued.input);
      commit_queue({
        ...queue_ref.current,
        [session_key]: (queue_ref.current[session_key] ?? []).filter((item) => item.message_id !== message_id),
      });
    } catch (reason) {
      commit_queue({
        ...queue_ref.current,
        [session_key]: (queue_ref.current[session_key] ?? []).map((item) => item.message_id === message_id ? { ...item, sending: false } : item),
      });
      set_error(to_error_message(reason));
      throw reason;
    }
  }, [commit_queue]);

  const update_queued_message = useCallback((workspace_id: string, agent_id: string, session_id: string, message_id: string, text: string) => {
    const normalized_text = text.trim();
    if (!normalized_text) return;
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    commit_queue({
      ...queue_ref.current,
      [session_key]: (queue_ref.current[session_key] ?? []).map((item) => item.message_id === message_id && !item.sending ? { ...item, input: create_chat_composer(normalized_text) } : item),
    });
  }, [commit_queue]);

  const toggle_queued_message_paused = useCallback((workspace_id: string, agent_id: string, session_id: string, message_id: string) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    commit_queue({
      ...queue_ref.current,
      [session_key]: (queue_ref.current[session_key] ?? []).map((item) => item.message_id === message_id && !item.sending ? { ...item, paused: !item.paused } : item),
    });
    if (!queue_paused_ref.current[session_key] && !is_chat_busy(chat_runtime_ref.current[session_key])) void process_next_queue(workspace_id, agent_id, session_id);
  }, [commit_queue, process_next_queue]);

  const set_queue_paused = useCallback((workspace_id: string, agent_id: string, session_id: string, paused: boolean) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    const next = { ...queue_paused_ref.current, [session_key]: paused };
    queue_paused_ref.current = next;
    set_queue_paused_by_session(next);
    if (!paused && !is_chat_busy(chat_runtime_ref.current[session_key])) void process_next_queue(workspace_id, agent_id, session_id);
  }, [process_next_queue]);

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

  const list_global_env = useCallback(async () => {
    const next = normalize_global_env_text(await window.downcity.settings.list_env());
    set_global_env(next);
    return next;
  }, []);

  const update_global_env = useCallback(async (raw: string) => {
    try {
      set_global_env(normalize_global_env_text(await window.downcity.settings.update_env(raw)));
    } catch (reason) {
      set_error(to_error_message(reason));
      throw reason;
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
    notification_state,
    agents,
    workspaces,
    groups,
    groups_by_id,
    group_messages_by_group,
    group_member_statuses_by_group,
    group_phase_by_group,
    group_read_message_ids_by_group,
    group_interactions_by_group,
    sessions_by_workspace,
    group_sessions_by_workspace,
    archived_sessions_by_workspace,
    messages_by_session,
    chat_runtime_by_session,
    draft_content_by_session,
    queued_messages_by_session,
    queue_paused_by_session,
    history_by_session,
    models,
    plugins,
    configuration_by_session,
    models_loading,
    selection,
    active_workspace_id,
    sidebar_mode,
    plugin_routes,
    plugin_revisions,
    settings,
    global_env,
    user,
    accounts,
    account_resources,
    error,
    loading,
    select_agent,
    open_create_agent,
    select_group,
    open_agent_chat,
    select_plugin,
    select_plugins,
    select_plugin_workspace,
    navigate_plugin,
    invalidate_plugin,
    set_sidebar_mode,
    select_workspace,
    select_workspace_file,
    create_group,
    open_create_group,
    update_group,
    remove_group,
    open_group,
    create_group_session,
    switch_group_draft_context,
    rename_group_session,
    remove_group_session,
    send_group_message,
    update_group_draft,
    stop_group,
    respond_group_interaction,
    open_settings,
    close_settings,
    create_session,
    switch_draft_context,
    select_session,
    fork_session,
    rewrite_session_message,
    rename_session,
    archive_session,
    remove_session,
    load_archived_sessions,
    load_earlier_history,
    create_agent,
    get_agent,
    update_agent,
    remove_agent,
    choose_agent_avatar,
    remove_agent_avatar,
    generate_agent_avatar,
    get_plugin,
    create_plugin_profile,
    remove_plugin_profile,
    invoke_plugin_action,
    create_workspace,
    update_workspace_name,
    write_workspace_readme,
    remove_workspace,
    update_draft,
    send_message,
    compact_session,
    refresh_models,
    set_session_model,
    set_session_reasoning_effort,
    set_session_approval_mode,
    stop_session,
    respond_interaction,
    remove_queued_message,
    send_queued_message,
    update_queued_message,
    toggle_queued_message_paused,
    set_queue_paused,
    move_queued_message,
    update_settings,
    list_global_env,
    update_global_env,
    login,
    list_login_providers,
    logout,
    switch_account,
    remove_account,
    clear_error: () => set_error(""),
  };
}

/** 将 Group 摘要按 Workspace 建立 Sidebar 索引。 */
function index_group_sessions(groups: DesktopGroupSummary[]): DesktopViewController["group_sessions_by_workspace"] {
  const indexed: DesktopViewController["group_sessions_by_workspace"] = {};
  for (const group of groups) {
    for (const session of group.sessions) {
      if (!session.workspace_id) continue;
      (indexed[session.workspace_id] ??= []).push({ group_id: group.group_id, group, session });
    }
  }
  return indexed;
}

/** 把一个 Group 合并进 Workspace Sidebar 索引。 */
function merge_group_sessions(current: DesktopViewController["group_sessions_by_workspace"], group: DesktopGroupSummary): DesktopViewController["group_sessions_by_workspace"] {
  return index_group_sessions([...unique_groups(Object.values(current).flat().map((entry) => entry.group).filter((item) => item.group_id !== group.group_id)), group]);
}

/** 替换一个 Group 在 Workspace Sidebar 中的所有会话。 */
function replace_group_sessions(current: DesktopViewController["group_sessions_by_workspace"], group: DesktopGroupSummary): DesktopViewController["group_sessions_by_workspace"] {
  return merge_group_sessions(current, group);
}

/** 从 Workspace Sidebar 索引移除一个 Group。 */
function remove_group_sessions(current: DesktopViewController["group_sessions_by_workspace"], group_id: string): DesktopViewController["group_sessions_by_workspace"] {
  return index_group_sessions(unique_groups(Object.values(current).flat().map((entry) => entry.group).filter((item) => item.group_id !== group_id)));
}

/** 去除 Workspace 索引反向展开产生的重复 Group。 */
function unique_groups(groups: DesktopGroupSummary[]): DesktopGroupSummary[] {
  return [...new Map(groups.map((group) => [group.group_id, group])).values()];
}
