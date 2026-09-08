/**
 * Downcity Desktop Renderer 根控制器（组合层）。
 *
 * 只做两件事：
 * 1. 组装 7 个 domain store 的句柄与 action；
 * 2. 编排跨 store 的动作（send_message / open_session / remove_agent 等）。
 *
 * 对外只暴露稳定 store 句柄与 action；视图按最小切片订阅 store。
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RespondSessionInteractionInput } from "@downcity/agent";
import type { JSONContent } from "@tiptap/core";
import type { DesktopChatRewriteInput, DesktopSessionConfiguration, DesktopSessionSummary } from "../../common/types/DesktopApi.ts";
import { get_session_key, is_workspace_chat_key } from "@/features/chat/lib/chat_cache_key";
import { is_chat_busy, get_draft_session_id, is_draft_session_id, type ChatSubmitMode, type CreateWorkspaceFormValue, type DesktopActions, type DesktopController, type DesktopWorkspaceSession, type NavigationTarget, type QueuedChatMessage, type SidebarMode } from "@/types/DesktopView";
import { desktop_navigation_storage_key, get_sidebar_mode_for_navigation, parse_navigation_target, resolve_navigation_target } from "@/features/navigation/lib/desktop_navigation_state";
import { use_store_selector } from "@/lib/store";
import type { Store } from "@/types/DesktopStore";
import { use_chat_stream_store } from "@/features/chat/state/use_chat_stream_store";
import { use_chat_lifecycle } from "@/features/chat/state/use_chat_lifecycle";
import { use_catalog_store } from "@/app/state/use_catalog_store";
import { use_navigation_store } from "@/features/navigation/state/use_navigation_store";
import { use_session_store } from "@/features/chat/state/use_session_store";
import { use_composer_store } from "@/features/chat/state/use_composer_store";
import { use_settings_store, to_error_message, normalize_global_env_text } from "@/features/settings/state/use_settings_store";
import { use_notification_store } from "@/features/notification/state/use_notification_store";
import { use_desktop_management_actions } from "@/app/use_management_actions";
import { use_desktop_group_actions } from "@/features/chat/hooks/use_group_actions";
import { use_desktop_navigation_actions } from "@/features/navigation/use_navigation_actions";
import { update_group_session_title } from "@/features/chat/lib/group/group_session_projection";
import { create_chat_composer, is_chat_composer_empty } from "@/features/chat/composer/editor/chatComposerCodec";
import { group_agent_sessions_by_workspace } from "@/features/chat/lib/session_list_projection";
import { translate } from "@/locales/i18n";

const active_workspace_storage_key = "downcity.active_workspace_id";

/** 从当前导航目标解析需要受 LRU 保护的 Agent Session 缓存键。 */
function get_active_session_cache_key(selection: NavigationTarget | null): string | undefined {
  if (selection?.kind !== "session") return undefined;
  return get_session_key(selection.workspace_id, selection.agent_id, selection.session_id);
}

/** 订阅一个领域 store 的最小切片。 */
export function use_desktop_selector<State, Slice>(store: Store<State>, selector: (state: State) => Slice): Slice {
  return use_store_selector(store, selector);
}

/** 管理 Renderer 根状态，并把异步 IPC 细节隔离在视图组件之外。 */
export function use_desktop_controller(): DesktopController {
  const chat_stream = use_chat_stream_store();
  const catalog = use_catalog_store();
  const navigation = use_navigation_store();
  const session = use_session_store();
  const composer = use_composer_store();
  const settings = use_settings_store();
  const notification = use_notification_store(settings.set_error);
  const management = use_desktop_management_actions({ catalog, navigation, session, settings });
  const chat_lifecycle = use_chat_lifecycle();

  // 组合层只保留跨领域导航引用；Chat 请求生命周期由 chat_lifecycle 统一拥有。
  const hydrated_navigation_keys_ref = useRef(new Set<string>());
  const active_group_session_ids_ref = useRef(new Map<string, string>());
  const previous_selection_ref = useRef<NavigationTarget | null>(null);
  const selection_by_sidebar_mode_ref = useRef<Partial<Record<SidebarMode, NavigationTarget>>>({});
  const send_message_ref = useRef<(workspace_id: string, agent_id: string, session_id: string, input: JSONContent, mode: ChatSubmitMode, skip_orphan_check?: boolean) => Promise<void>>(async () => undefined);
  const navigation_actions = use_desktop_navigation_actions({
    catalog,
    navigation,
    settings,
    previous_selection_ref,
    selection_by_sidebar_mode_ref,
  });
  const group_actions = use_desktop_group_actions({
    catalog,
    chat_stream,
    composer,
    navigation,
    settings,
    active_group_session_ids_ref,
    hydrated_navigation_keys_ref,
  });

  // 首次并行加载本地与远端资料
  useEffect(() => {
    void Promise.all([
      window.downcity.agent.list(),
      window.downcity.workspace.list(),
      window.downcity.group.list(),
      window.downcity.settings.get(),
      window.downcity.settings.list_env(),
      window.downcity.plugin.list(),
      composer.hydrate_composer(),
    ]).then(async ([next_agents, next_workspaces, next_groups, next_settings, next_env, next_plugins]) => {
      catalog.replace_catalog({
        agents: next_agents,
        workspaces: next_workspaces,
        groups: next_groups,
        groups_by_id: Object.fromEntries(next_groups.map((group) => [group.group_id, group])),
        plugins: next_plugins,
      });
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
      if (restored_session_entries.length > 0) session.replace_all_sessions(initial_sessions_by_workspace);
      settings.set_settings(next_settings);
      settings.set_global_env(normalize_global_env_text(next_env));
      const initial_agent = next_agents.find((agent) => agent.agent_id === next_settings.default_agent_id) ?? next_agents[0];
      const stored_workspace_id = localStorage.getItem(active_workspace_storage_key) || "";
      const initial_workspace = next_workspaces.find((workspace) => workspace.workspace_id === stored_workspace_id)
        ?? next_workspaces[0];
      if (initial_workspace) {
        navigation.set_active_workspace_id(initial_workspace.workspace_id);
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
          navigation.set_active_workspace_id(restored_target.workspace_id);
          localStorage.setItem(active_workspace_storage_key, restored_target.workspace_id);
        }
        navigation.set_sidebar_mode(get_sidebar_mode_for_navigation(restored_target));
        navigation.set_selection(restored_target);
      } else if (initial_agent && initial_workspace && next_settings.open_empty_chat_on_start) {
        navigation.set_selection({ kind: "draft", workspace_id: initial_workspace.workspace_id, agent_id: initial_agent.agent_id, draft_id: get_draft_session_id(initial_agent.agent_id) });
      } else if (initial_workspace) {
        navigation.set_sidebar_mode("workspace");
        navigation.set_selection({ kind: "workspace", workspace_id: initial_workspace.workspace_id });
      }
      // Session 属于 Agent；导航恢复完成后异步加载完整目录，避免局部恢复结果覆盖全量目录。
      void Promise.all(next_agents.map(async (agent) => ({
        agent_id: agent.agent_id,
        sessions: await window.downcity.chat.list_sessions(agent.agent_id),
      }))).then((sessions_by_agent) => {
        session.replace_all_sessions(group_agent_sessions_by_workspace(sessions_by_agent));
      }).catch((reason) => settings.set_error(to_error_message(reason)));
    }).catch((reason) => settings.set_error(to_error_message(reason))).finally(() => settings.set_loading(false));
    // 远端资料刷新不能阻塞本地 Agent、Workspace 与设置进入可用状态。
    void window.downcity.user.current()
      .then((current_user) => {
        settings.set_user(current_user);
        void window.downcity.user.list_accounts().then(settings.set_accounts).catch(() => undefined);
        if (current_user.authenticated) {
          catalog.set_models_loading(true);
          void window.downcity.chat.list_models()
            .then((models) => catalog.set_models(models, false))
            .catch(() => catalog.set_models([], false));
          void window.downcity.user.get_resources().then(settings.set_account_resources).catch(() => undefined);
        }
      })
      .catch((reason) => settings.set_user({ ...settings.state_ref.current.user, error: to_error_message(reason) }));
  }, [catalog, composer, navigation, session, settings]);

  // ---- 队列发送循环 ----
  const commit_queue = useCallback((next: Record<string, QueuedChatMessage[]>) => {
    composer.replace_all_queue(next);
  }, [composer]);

  /** 提交队首消息；同一 Session 同时只执行一个提交循环。 */
  const process_next_queue = useCallback(async (workspace_id: string, agent_id: string, session_id: string): Promise<void> => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    if (chat_lifecycle.is_session_unavailable(session_key) || chat_lifecycle.is_queue_processing(session_key) || composer.state_ref.current.queue_paused_by_session[session_key] || is_chat_busy(chat_stream.state_ref.current.chat_runtime_by_session[session_key])) return;
    const queued = composer.state_ref.current.queued_messages_by_session[session_key]?.[0];
    if (!queued || queued.paused) return;
    if (!chat_lifecycle.begin_queue_processing(session_key)) return;
    commit_queue({
      ...composer.state_ref.current.queued_messages_by_session,
      [session_key]: (composer.state_ref.current.queued_messages_by_session[session_key] ?? []).map((item, index) => index === 0 ? { ...item, sending: true } : item),
    });
    let accepted = false;
    try {
      await window.downcity.chat.send(agent_id, workspace_id, session_id, queued.input);
      accepted = true;
      commit_queue({
        ...composer.state_ref.current.queued_messages_by_session,
        [session_key]: (composer.state_ref.current.queued_messages_by_session[session_key] ?? []).filter((item) => item.message_id !== queued.message_id),
      });
    } catch (reason) {
      if (chat_lifecycle.is_session_deleted(session_key)) return;
      commit_queue({
        ...composer.state_ref.current.queued_messages_by_session,
        [session_key]: (composer.state_ref.current.queued_messages_by_session[session_key] ?? []).map((item) => item.message_id === queued.message_id ? { ...item, sending: false } : item),
      });
      settings.set_error(to_error_message(reason));
    } finally {
      chat_lifecycle.finish_queue_processing(session_key);
      if (accepted && !is_chat_busy(chat_stream.state_ref.current.chat_runtime_by_session[session_key])) {
        void process_next_queue(workspace_id, agent_id, session_id);
      }
    }
  }, [chat_lifecycle, chat_stream, commit_queue, composer, settings]);

  // ---- Group 流式订阅 ----
  useEffect(() => {
    const unsubscribe = window.downcity.group.subscribe((event) => {
      if (event.type === "title") {
        const group = catalog.state_ref.current.groups_by_id[event.group_id];
        if (group) catalog.upsert_group(update_group_session_title(group, event.group_id, event.session_id, event.title));
        return;
      }
      const active_session_id = active_group_session_ids_ref.current.get(event.group_id);
      if (!active_session_id || active_session_id !== event.session_id) return;
      if (event.type === "interaction") {
        chat_stream.upsert_group_interaction(event.group_id, {
          agent_id: event.agent_id,
          part: {
            part_id: `group-interaction:${event.request.interaction_id}`,
            sequence: 1,
            type: "interaction",
            interaction_id: event.request.interaction_id,
            interaction_type: event.request.type,
            status: "pending",
            request: event.request,
          },
        });
        return;
      }
      if (event.type === "status") {
        chat_stream.set_group_status(event.group_id, event.members.filter((status) => status.running), event.phase);
        if (event.phase === "dispatched" && event.dispatched_member_ids && event.message_id) {
          chat_stream.add_group_read_id(event.group_id, event.message_id);
        }
        return;
      }
      chat_stream.append_group_message(event.group_id, event.message);
    });
    return unsubscribe;
  }, [catalog, chat_stream]);

  // ---- Chat 流式订阅：mutation 批处理 + runtime / 队列接力 ----
  useEffect(() => {
    const unsubscribe_mutation = window.downcity.chat.on_mutation(({ agent_id, workspace_id, session_id, mutation }) => {
      const session_key = get_session_key(workspace_id, agent_id, session_id);
      if (chat_lifecycle.is_session_deleted(session_key)) return;
      if (mutation.variant === "file_diff") {
        chat_stream.set_file_diff(session_key, {
          turn_id: mutation.turn_id,
          files_count: mutation.files_count,
          additions: mutation.additions,
          deletions: mutation.deletions,
        });
        return;
      }
      chat_stream.enqueue_mutation(session_key, mutation);
      if (mutation.variant === "session" && mutation.type === "title") {
        const entries = session.state_ref.current.sessions_by_workspace[workspace_id] ?? [];
        const updated = entries.map((item) => item.agent_id === agent_id && item.session.session_id === session_id
          ? { ...item, session: { ...item.session, title: mutation.title, updated_at: mutation.created_at } }
          : item);
        if (updated.some((item, index) => item !== entries[index])) session.set_workspace_sessions(workspace_id, updated);
      }
    });
    const unsubscribe_runtime = window.downcity.chat.on_runtime(({ runtime }) => {
      const session_key = get_session_key(runtime.workspace_id, runtime.agent_id, runtime.session_id);
      if (chat_lifecycle.is_session_deleted(session_key)) return;
      chat_stream.set_runtime(session_key, runtime);
      if (!is_chat_busy(runtime)) void process_next_queue(runtime.workspace_id, runtime.agent_id, runtime.session_id);
    });
    return () => {
      unsubscribe_mutation();
      unsubscribe_runtime();
      chat_stream.cancel_pending_mutations();
    };
  }, [chat_lifecycle, chat_stream, process_next_queue, session]);

  // ---- Session 打开 / 快照 / 删除 ----
  const discard_session_render_state = useCallback((source_key: string) => {
    chat_stream.remove_messages(source_key);
    chat_stream.remove_runtime(source_key);
    chat_stream.remove_file_diff(source_key);
    chat_stream.remove_history(source_key);
    chat_stream.remove_configuration(source_key);
    composer.remove_draft(source_key);
    composer.remove_queue(source_key);
  }, [chat_stream, composer]);

  /**
   * 读取并提交一个 Session 的 canonical 快照。
   *
   * 同一 Session 同时收到窗口 focus 与 visibilitychange 时复用同一个 Promise，避免
   * 重复 IPC；request_id 继续负责删除等跨生命周期操作的迟到响应屏蔽。
   */
  const load_session_snapshot = useCallback((workspace_id: string, agent_id: string, session_id: string): Promise<void> => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    if (chat_lifecycle.is_session_unavailable(session_key)) return Promise.resolve();
    const pending_load = chat_lifecycle.get_snapshot_load(session_key);
    if (pending_load) return pending_load;

    const request_id = chat_lifecycle.begin_snapshot_request(session_key);
    chat_stream.begin_session_snapshot(session_key);
    const loading = (async () => {
      let snapshot_succeeded = false;
      try {
        const [snapshot, configuration] = await Promise.all([
          window.downcity.chat.get_snapshot(agent_id, workspace_id, session_id),
          window.downcity.chat.get_configuration(agent_id, workspace_id, session_id),
        ]);
        if (!chat_lifecycle.is_snapshot_request_current(session_key, request_id)) return;
        chat_stream.merge_messages(session_key, snapshot.messages);
        chat_stream.set_history(session_key, { loading: false, has_more: snapshot.has_more, next_before_sequence: snapshot.next_before_sequence });
        const current_runtime = chat_stream.state_ref.current.chat_runtime_by_session[session_key];
        const next_runtime = current_runtime && current_runtime.updated_at > snapshot.runtime.updated_at ? current_runtime : snapshot.runtime;
        chat_stream.set_runtime(session_key, next_runtime);
        chat_stream.set_configuration(session_key, configuration);
        snapshot_succeeded = true;
      } catch (reason) {
        if (!chat_lifecycle.is_snapshot_request_current(session_key, request_id)) return;
        settings.set_error(to_error_message(reason));
      } finally {
        chat_stream.finish_session_snapshot(session_key, snapshot_succeeded);
        chat_stream.trim_render_cache(get_active_session_cache_key(navigation.state_ref.current.selection));
      }
    })();
    chat_lifecycle.set_snapshot_load(session_key, loading);
    return loading;
  }, [chat_lifecycle, chat_stream, navigation, settings]);

  /** 打开 Session 并读取快照；不检查 Workspace 归属，供 rebind 完成后直接进入。 */
  const open_session = useCallback(async (workspace_id: string, agent_id: string, session_id: string, preserve_sidebar = false) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    if (chat_lifecycle.is_session_unavailable(session_key)) return;
    hydrated_navigation_keys_ref.current.add(`session:${session_key}`);
    settings.set_error("");
    if (!preserve_sidebar) navigation.set_sidebar_mode("chat");
    navigation.set_active_workspace_id(workspace_id);
    navigation.set_selection({ kind: "session", workspace_id, agent_id, session_id });
    await load_session_snapshot(workspace_id, agent_id, session_id);
  }, [chat_lifecycle, load_session_snapshot, navigation, settings]);

  const select_session = useCallback(async (workspace_id: string, agent_id: string, session_id: string, preserve_sidebar = false) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    if (chat_lifecycle.is_session_unavailable(session_key)) return;
    await open_session(workspace_id, agent_id, session_id, preserve_sidebar);
  }, [chat_lifecycle, open_session]);

  /** 刷新恢复 Session 时，通过既有快照入口补齐消息、配置与运行态。 */
  useEffect(() => {
    const hydrate_session = () => {
      const selection = navigation.state_ref.current.selection;
      if (selection?.kind !== "session") return;
      const session_key = get_session_key(selection.workspace_id, selection.agent_id, selection.session_id);
      const navigation_key = `session:${session_key}`;
      if (hydrated_navigation_keys_ref.current.has(navigation_key)) return;
      hydrated_navigation_keys_ref.current.add(navigation_key);
      void select_session(selection.workspace_id, selection.agent_id, selection.session_id, true);
    };
    hydrate_session();
    return navigation.store.subscribe(hydrate_session);
  }, [navigation.state_ref, navigation.store, select_session]);

  /** 导航离开 Agent Session 时立即解除激活保护并收敛渲染缓存容量。 */
  useEffect(() => {
    const trim_for_navigation = () => {
      chat_stream.trim_render_cache(get_active_session_cache_key(navigation.state_ref.current.selection));
    };
    trim_for_navigation();
    return navigation.store.subscribe(trim_for_navigation);
  }, [chat_stream, navigation.state_ref, navigation.store]);

  /** 刷新当前 Agent Session 的 canonical 快照，恢复窗口切换期间错过的 mutation。 */
  const refresh_session_snapshot = useCallback((workspace_id: string, agent_id: string, session_id: string): Promise<void> => (
    load_session_snapshot(workspace_id, agent_id, session_id)
  ), [load_session_snapshot]);

  /** 窗口重新可见或获得焦点时同步当前 Session，避免漏掉后台期间的交互事件。 */
  useEffect(() => {
    const refresh_current_session = () => {
      if (document.visibilityState === "hidden") return;
      const current = navigation.state_ref.current.selection;
      if (current?.kind === "session") void refresh_session_snapshot(current.workspace_id, current.agent_id, current.session_id);
    };
    document.addEventListener("visibilitychange", refresh_current_session);
    window.addEventListener("focus", refresh_current_session);
    return () => {
      document.removeEventListener("visibilitychange", refresh_current_session);
      window.removeEventListener("focus", refresh_current_session);
    };
  }, [navigation.state_ref, refresh_session_snapshot]);

  const create_session = useCallback(async (workspace_id: string, agent_id: string) => {
    settings.set_error("");
    navigation.set_sidebar_mode("chat");
    const draft_id = get_draft_session_id(agent_id);
    const session_key = get_session_key(workspace_id, agent_id, draft_id);
    const agent = catalog.state_ref.current.agents.find((item) => item.agent_id === agent_id);
    chat_stream.set_configuration(session_key, chat_stream.state_ref.current.configuration_by_session[session_key] ?? { model_id: agent?.model_id || "", approval_mode: "ask" });
    navigation.set_active_workspace_id(workspace_id);
    navigation.set_selection({ kind: "draft", workspace_id, agent_id, draft_id });
  }, [catalog, chat_stream, navigation, settings]);

  /** 将当前 Draft 的全部编辑状态移动到新的 Workspace 与 Agent。 */
  const switch_draft_context = useCallback((workspace_id: string, agent_id: string) => {
    const selection = navigation.state_ref.current.selection;
    if (selection?.kind !== "draft") return;
    const source_key = get_session_key(selection.workspace_id, selection.agent_id, selection.draft_id);
    const draft_id = get_draft_session_id(agent_id);
    const target_key = get_session_key(workspace_id, agent_id, draft_id);
    if (source_key === target_key) return;
    composer.move_draft(source_key, target_key);
    const agent = catalog.state_ref.current.agents.find((item) => item.agent_id === agent_id);
    const fallback_configuration = {
      model_id: settings.state_ref.current.settings.default_text_model_id || agent?.model_id || "",
      approval_mode: "ask" as const,
    };
    chat_stream.move_configuration(source_key, target_key, fallback_configuration);
    navigation.set_active_workspace_id(workspace_id);
    localStorage.setItem(active_workspace_storage_key, workspace_id);
    navigation.set_selection({ kind: "draft", workspace_id, agent_id, draft_id });
  }, [catalog, chat_stream, composer, navigation, settings]);

  /** 创建分支 Session，将其加入导航列表并立即打开。 */
  const fork_session = useCallback(async (workspace_id: string, agent_id: string, session_id: string, message_id: string) => {
    settings.set_error("");
    try {
      const forked_session = await window.downcity.chat.fork_session(agent_id, workspace_id, session_id, message_id);
      session.prepend_session(workspace_id, agent_id, forked_session);
      await select_session(workspace_id, agent_id, forked_session.session_id);
    } catch (reason) {
      settings.set_error(to_error_message(reason));
      throw reason;
    }
  }, [select_session, session, settings]);

  /** 重写历史用户消息，并将承载新 Turn 的 Session 设为当前会话。 */
  const rewrite_session_message = useCallback(async (workspace_id: string, agent_id: string, session_id: string, input: DesktopChatRewriteInput) => {
    settings.set_error("");
    const source_key = get_session_key(workspace_id, agent_id, session_id);
    try {
      if (input.action === "replace" && (composer.state_ref.current.queued_messages_by_session[source_key]?.length ?? 0) > 0) {
        throw new Error(translate("chat:message.replace_blocked_queue"));
      }
      const result = await window.downcity.chat.rewrite_session_message(agent_id, workspace_id, session_id, input);
      session.prepend_session(workspace_id, agent_id, result.session);
      const result_key = get_session_key(workspace_id, agent_id, result.session.session_id);
      if (result.source_disposition === "archived") {
        // replace 事务显式转移草稿所有权；队列在提交前已被拒绝，不能静默迁移或删除。
        composer.move_draft(source_key, result_key);
        session.remove_session(workspace_id, agent_id, session_id);
        chat_lifecycle.discard_session(source_key);
        discard_session_render_state(source_key);
      }
      if (result.warning) settings.set_error(result.warning);
      await select_session(workspace_id, agent_id, result.session.session_id);
    } catch (reason) {
      settings.set_error(to_error_message(reason));
      throw reason;
    }
  }, [chat_lifecycle, composer, discard_session_render_state, select_session, session, settings]);

  const rename_session = useCallback(async (workspace_id: string, agent_id: string, session_id: string, title: string) => {
    try {
      const normalized_title = await window.downcity.chat.rename_session(agent_id, workspace_id, session_id, title);
      const entries = session.state_ref.current.sessions_by_workspace[workspace_id] ?? [];
      const updated = entries.map((item) => item.agent_id === agent_id && item.session.session_id === session_id
        ? { ...item, session: { ...item.session, title: normalized_title, updated_at: Date.now() } }
        : item);
      if (updated.some((item, index) => item !== entries[index])) session.set_workspace_sessions(workspace_id, updated);
    } catch (reason) {
      settings.set_error(to_error_message(reason));
      throw reason;
    }
  }, [session, settings]);

  const archive_session = useCallback(async (workspace_id: string, agent_id: string, session_id: string) => {
    try {
      await window.downcity.chat.archive_session(agent_id, workspace_id, session_id);
      session.remove_session(workspace_id, agent_id, session_id);
      const current_selection = navigation.state_ref.current.selection;
      if (current_selection?.kind === "session" && current_selection.workspace_id === workspace_id && current_selection.agent_id === agent_id && current_selection.session_id === session_id) {
        navigation.set_selection({ kind: "draft", workspace_id, agent_id, draft_id: get_draft_session_id(agent_id) });
      }
    } catch (reason) {
      settings.set_error(to_error_message(reason));
      throw reason;
    }
  }, [navigation, session, settings]);

  const remove_session = useCallback(async (workspace_id: string, agent_id: string, session_id: string) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    chat_lifecycle.begin_session_delete(session_key);
    try {
      await window.downcity.chat.remove_session(agent_id, workspace_id, session_id);
      chat_lifecycle.finish_session_delete(session_key);
      session.remove_session(workspace_id, agent_id, session_id);
      discard_session_render_state(session_key);
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
      const current_selection = navigation.state_ref.current.selection;
      if (current_selection?.kind === "session" && current_selection.workspace_id === workspace_id && current_selection.agent_id === agent_id && current_selection.session_id === session_id) {
        navigation.set_selection(fallback_selection);
      }
    } catch (reason) {
      chat_lifecycle.cancel_session_delete(session_key);
      settings.set_error(to_error_message(reason));
      throw reason;
    }
  }, [chat_lifecycle, discard_session_render_state, navigation, session, settings]);

  /** 打开 Agent 最近更新的 Session；没有历史时进入未持久化的新对话。 */
  const open_agent_chat = useCallback(async (agent_id: string) => {
    settings.set_error("");
    try {
      let latest_session: { workspace_id: string; session: DesktopSessionSummary } | undefined;
      for (const [workspace_id, entries] of Object.entries(session.state_ref.current.sessions_by_workspace)) {
        for (const entry of entries) {
          if (entry.agent_id !== agent_id || latest_session && entry.session.updated_at <= latest_session.session.updated_at) continue;
          latest_session = { workspace_id, session: entry.session };
        }
      }
      if (latest_session) {
        await select_session(latest_session.workspace_id, agent_id, latest_session.session.session_id, true);
        return;
      }
      const target_workspace = catalog.state_ref.current.workspaces.find((workspace) => workspace.workspace_id === navigation.state_ref.current.active_workspace_id)
        ?? catalog.state_ref.current.workspaces[0]
        ?? await window.downcity.workspace.get_default();
      const workspace_id = target_workspace.workspace_id;
      if (!catalog.state_ref.current.workspaces.some((workspace) => workspace.workspace_id === workspace_id)) {
        catalog.add_workspace(target_workspace);
      }
      await create_session(workspace_id, agent_id);
    } catch (reason) {
      settings.set_error(to_error_message(reason));
    }
  }, [catalog, create_session, navigation, select_session, session, settings]);

  /** 加载一个更早历史 Segment。 */
  const load_earlier_history = useCallback(async (workspace_id: string, agent_id: string, session_id: string) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    const current_history = chat_stream.state_ref.current.history_by_session[session_key];
    if (!current_history?.has_more || !current_history.next_before_sequence || current_history.loading) return;
    const loading_history = { ...current_history, loading: true };
    chat_stream.set_history(session_key, loading_history);
    chat_stream.begin_session_snapshot(session_key);
    let snapshot_succeeded = false;
    try {
      const page = await window.downcity.chat.get_history(agent_id, workspace_id, session_id, current_history.next_before_sequence);
      chat_stream.merge_messages(session_key, page.messages);
      const next_history = { loading: false, has_more: page.has_more, next_before_sequence: page.next_before_sequence };
      chat_stream.set_history(session_key, next_history);
      snapshot_succeeded = true;
    } catch (reason) {
      const next_history = { ...loading_history, loading: false };
      chat_stream.set_history(session_key, next_history);
      settings.set_error(to_error_message(reason));
    } finally {
      chat_stream.finish_session_snapshot(session_key, snapshot_succeeded);
      chat_stream.trim_render_cache(get_active_session_cache_key(navigation.state_ref.current.selection));
    }
  }, [chat_stream, navigation, settings]);

  const clear_session_attach_request = useCallback(() => {
    session.set_session_attach_request(null);
  }, [session]);

  /** 把孤儿 Session 重新绑定到用户选择的 Workspace，并进入该 Session。 */
  const rebind_session_workspace = useCallback(async (agent_id: string, session_id: string, workspace_id: string) => {
    settings.set_error("");
    const pending_input = session.state_ref.current.session_attach_request?.pending_input;
    session.set_session_attach_request(null);
    try {
      const rebound_session = await window.downcity.chat.rebind_session_workspace(agent_id, session_id, workspace_id);
      // 从全部旧分组移除该 Session，再放入新 Workspace 分组。
      session.replace_all_sessions(rebind_entries(session.state_ref.current.sessions_by_workspace, agent_id, session_id, workspace_id, rebound_session));
      if (pending_input) {
        await send_message_ref.current(workspace_id, agent_id, session_id, pending_input, "send", true);
      }
    } catch (reason) {
      settings.set_error(to_error_message(reason));
    }
  }, [session, settings]);

  /** 新建 Workspace 并立即绑定孤儿 Session，然后进入该 Session。 */
  const create_workspace_for_session = useCallback(async (value: CreateWorkspaceFormValue, agent_id: string, session_id: string) => {
    settings.set_error("");
    try {
      const workspace = await window.downcity.workspace.create(value);
      catalog.add_workspace(workspace);
      await rebind_session_workspace(agent_id, session_id, workspace.workspace_id);
    } catch (reason) {
      settings.set_error(to_error_message(reason));
    }
  }, [catalog, rebind_session_workspace, settings]);

  const load_archived_sessions = useCallback(async (workspace_id: string) => {
    try {
      const entries = await Promise.all(catalog.state_ref.current.agents.map(async (agent) => {
        const sessions = await window.downcity.chat.list_archived_sessions(agent.agent_id, workspace_id);
        return sessions.map((s) => ({ agent_id: agent.agent_id, session: s }));
      }));
      session.set_archived_sessions(workspace_id, entries.flat());
    } catch (reason) {
      settings.set_error(to_error_message(reason));
      throw reason;
    }
  }, [catalog, session, settings]);

  // ---- 发送与队列 ----
  const update_draft = useCallback((workspace_id: string, agent_id: string, session_id: string, input: JSONContent) => {
    composer.set_draft(get_session_key(workspace_id, agent_id, session_id), input);
  }, [composer]);

  const send_message = useCallback(async (workspace_id: string, agent_id: string, session_id: string, input: JSONContent, mode: ChatSubmitMode = "send", skip_orphan_check = false) => {
    if (is_chat_composer_empty(input)) return;
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    settings.set_error("");
    composer.remove_draft(session_key);
    if (is_draft_session_id(session_id)) {
      let target_key = session_key;
      try {
        const agent = catalog.state_ref.current.agents.find((item) => item.agent_id === agent_id);
        const draft_configuration = chat_stream.state_ref.current.configuration_by_session[session_key] ?? {
          model_id: settings.state_ref.current.settings.default_text_model_id || agent?.model_id || "",
          approval_mode: "ask",
        };
        const created = await window.downcity.chat.create_session(agent_id, workspace_id, draft_configuration);
        session.prepend_session(workspace_id, agent_id, created.session);
        target_key = get_session_key(workspace_id, agent_id, created.session.session_id);
        chat_stream.remove_configuration(session_key);
        chat_stream.set_configuration(target_key, created.configuration);
        navigation.set_selection({ kind: "session", workspace_id, agent_id, session_id: created.session.session_id });
        await window.downcity.chat.send(agent_id, workspace_id, created.session.session_id, input);
        composer.remove_draft(target_key);
      } catch (reason) {
        composer.set_draft(target_key, input);
        settings.set_error(to_error_message(reason));
        throw reason;
      }
      return;
    }
    // 孤儿 Session 的 Workspace 已从 Registry 移除；发送前必须由用户显式选择 Workspace 绑定。
    if (!skip_orphan_check && !catalog.state_ref.current.workspaces.some((workspace) => workspace.workspace_id === workspace_id)) {
      session.set_session_attach_request({ agent_id, session_id, workspace_id, pending_input: input });
      return;
    }
    if (mode === "queue" || is_chat_busy(chat_stream.state_ref.current.chat_runtime_by_session[session_key]) || (composer.state_ref.current.queued_messages_by_session[session_key]?.length ?? 0) > 0) {
      const queued: QueuedChatMessage = {
        message_id: crypto.randomUUID(),
        input,
        created_at: Date.now(),
        sending: false,
        paused: mode === "queue",
      };
      composer.append_queued(session_key, queued);
      if (!is_chat_busy(chat_stream.state_ref.current.chat_runtime_by_session[session_key])) void process_next_queue(workspace_id, agent_id, session_id);
      return;
    }
    try {
      await window.downcity.chat.send(agent_id, workspace_id, session_id, input);
    } catch (reason) {
      composer.set_draft(session_key, input);
      settings.set_error(to_error_message(reason));
    }
  }, [catalog, chat_stream, composer, navigation, process_next_queue, session, settings]);

  useEffect(() => { send_message_ref.current = send_message; }, [send_message]);

  const compact_session = useCallback(async (workspace_id: string, agent_id: string, session_id: string) => {
    if (is_draft_session_id(session_id)) return;
    settings.set_error("");
    try {
      await window.downcity.chat.compact_session(agent_id, workspace_id, session_id);
    } catch (reason) {
      settings.set_error(to_error_message(reason));
      throw reason;
    }
  }, [settings]);

  const set_session_model = useCallback(async (workspace_id: string, agent_id: string, session_id: string, model_id: string) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    try {
      if (is_draft_session_id(session_id)) {
        const current = chat_stream.state_ref.current.configuration_by_session[session_key] ?? { model_id, approval_mode: "ask" };
        const selected_model = catalog.state_ref.current.models.find((item) => item.model_id === model_id);
        const efforts = selected_model?.reasoning?.efforts ?? [];
        const reasoning_effort = efforts.find((item) => item.id === current.reasoning_effort)?.id
          || efforts.find((item) => item.id === selected_model?.reasoning?.default_effort)?.id
          || efforts[0]?.id;
        const { reasoning_effort: _old, ...base_configuration } = current;
        chat_stream.set_configuration(session_key, { ...base_configuration, model_id, ...(reasoning_effort ? { reasoning_effort } : {}) });
        return;
      }
      const configuration = await window.downcity.chat.set_model(agent_id, workspace_id, session_id, model_id);
      chat_stream.set_configuration(session_key, configuration);
    } catch (reason) {
      settings.set_error(to_error_message(reason));
    }
  }, [catalog, chat_stream, settings]);

  const set_session_reasoning_effort = useCallback(async (workspace_id: string, agent_id: string, session_id: string, reasoning_effort?: string) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    try {
      if (is_draft_session_id(session_id)) {
        const current = chat_stream.state_ref.current.configuration_by_session[session_key] ?? { model_id: catalog.state_ref.current.agents.find((item) => item.agent_id === agent_id)?.model_id || "", approval_mode: "ask" };
        const { reasoning_effort: _old, ...base_configuration } = current;
        chat_stream.set_configuration(session_key, { ...base_configuration, ...(reasoning_effort ? { reasoning_effort } : {}) });
        return;
      }
      const configuration = await window.downcity.chat.set_reasoning_effort(agent_id, workspace_id, session_id, reasoning_effort);
      chat_stream.set_configuration(session_key, configuration);
    } catch (reason) {
      settings.set_error(to_error_message(reason));
    }
  }, [catalog, chat_stream, settings]);

  const set_session_approval_mode = useCallback(async (
    workspace_id: string,
    agent_id: string,
    session_id: string,
    approval_mode: DesktopSessionConfiguration["approval_mode"],
  ) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    try {
      if (is_draft_session_id(session_id)) {
        const agent = catalog.state_ref.current.agents.find((item) => item.agent_id === agent_id);
        const current = chat_stream.state_ref.current.configuration_by_session[session_key] ?? { model_id: agent?.model_id || "", approval_mode };
        chat_stream.set_configuration(session_key, { ...current, approval_mode });
        return;
      }
      const configuration = await window.downcity.chat.set_approval_mode(agent_id, workspace_id, session_id, approval_mode);
      chat_stream.set_configuration(session_key, configuration);
    } catch (reason) {
      settings.set_error(to_error_message(reason));
    }
  }, [catalog, chat_stream, settings]);

  const stop_session = useCallback(async (workspace_id: string, agent_id: string, session_id: string) => {
    try {
      await window.downcity.chat.stop(agent_id, workspace_id, session_id);
    } catch (reason) {
      settings.set_error(to_error_message(reason));
    }
  }, [settings]);

  const respond_interaction = useCallback(async (
    workspace_id: string,
    agent_id: string,
    session_id: string,
    input: RespondSessionInteractionInput,
  ) => {
    try {
      await window.downcity.chat.respond(agent_id, workspace_id, session_id, input);
    } catch (reason) {
      settings.set_error(to_error_message(reason));
      throw reason;
    }
  }, [settings]);

  // ---- 队列消息操作 ----
  const remove_queued_message = useCallback((workspace_id: string, agent_id: string, session_id: string, message_id: string) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    composer.replace_queue(session_key, (composer.state_ref.current.queued_messages_by_session[session_key] ?? []).filter((item) => item.message_id !== message_id || item.sending));
  }, [composer]);

  const send_queued_message = useCallback(async (workspace_id: string, agent_id: string, session_id: string, message_id: string) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    const queued = composer.state_ref.current.queued_messages_by_session[session_key]?.find((item) => item.message_id === message_id);
    if (!queued || queued.sending) return;
    composer.replace_queue(session_key, (composer.state_ref.current.queued_messages_by_session[session_key] ?? []).map((item) => item.message_id === message_id ? { ...item, sending: true } : item));
    try {
      await window.downcity.chat.send(agent_id, workspace_id, session_id, queued.input);
      composer.replace_queue(session_key, (composer.state_ref.current.queued_messages_by_session[session_key] ?? []).filter((item) => item.message_id !== message_id));
    } catch (reason) {
      composer.replace_queue(session_key, (composer.state_ref.current.queued_messages_by_session[session_key] ?? []).map((item) => item.message_id === message_id ? { ...item, sending: false } : item));
      settings.set_error(to_error_message(reason));
      throw reason;
    }
  }, [composer, settings]);

  const update_queued_message = useCallback((workspace_id: string, agent_id: string, session_id: string, message_id: string, text: string) => {
    const normalized_text = text.trim();
    if (!normalized_text) return;
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    composer.replace_queue(session_key, (composer.state_ref.current.queued_messages_by_session[session_key] ?? []).map((item) => item.message_id === message_id && !item.sending ? { ...item, input: create_chat_composer(normalized_text) } : item));
  }, [composer]);

  const toggle_queued_message_paused = useCallback((workspace_id: string, agent_id: string, session_id: string, message_id: string) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    composer.replace_queue(session_key, (composer.state_ref.current.queued_messages_by_session[session_key] ?? []).map((item) => item.message_id === message_id && !item.sending ? { ...item, paused: !item.paused } : item));
    if (!composer.state_ref.current.queue_paused_by_session[session_key] && !is_chat_busy(chat_stream.state_ref.current.chat_runtime_by_session[session_key])) void process_next_queue(workspace_id, agent_id, session_id);
  }, [chat_stream, composer, process_next_queue]);

  const set_queue_paused = useCallback((workspace_id: string, agent_id: string, session_id: string, paused: boolean) => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    composer.set_queue_paused(session_key, paused);
    if (!paused && !is_chat_busy(chat_stream.state_ref.current.chat_runtime_by_session[session_key])) void process_next_queue(workspace_id, agent_id, session_id);
  }, [chat_stream, composer, process_next_queue]);

  const move_queued_message = useCallback((workspace_id: string, agent_id: string, session_id: string, message_id: string, direction: "up" | "down") => {
    const session_key = get_session_key(workspace_id, agent_id, session_id);
    const queue = [...(composer.state_ref.current.queued_messages_by_session[session_key] ?? [])];
    const index = queue.findIndex((item) => item.message_id === message_id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= queue.length || queue[index].sending || queue[target].sending) return;
    [queue[index], queue[target]] = [queue[target], queue[index]];
    composer.replace_queue(session_key, queue);
  }, [composer]);

  // Workspace 删除需要同时清理 Chat、Session、Composer 与控制引用，保留在组合层。
  const remove_workspace = useCallback(async (workspace_id: string) => {
    settings.set_error("");
    const normalized_workspace_id = String(workspace_id || "").trim();
    try {
      const removed = await window.downcity.workspace.remove(normalized_workspace_id);
      if (!removed) return;
      catalog.remove_workspace(normalized_workspace_id);
      const next_workspaces = catalog.state_ref.current.workspaces;
      const selection = navigation.state_ref.current.selection;
      const targets_removed_workspace = (selection?.kind === "workspace" || selection?.kind === "workspace_file") && selection.workspace_id === normalized_workspace_id;
      if (targets_removed_workspace) {
        navigation.set_selection(next_workspaces[0] ? { kind: "workspace", workspace_id: next_workspaces[0].workspace_id } : null);
      }
      session.remove_workspace(normalized_workspace_id);
      chat_stream.remove_workspace(normalized_workspace_id);
      composer.remove_workspace(normalized_workspace_id);
      chat_lifecycle.remove_workspace(normalized_workspace_id);
      for (const key of hydrated_navigation_keys_ref.current) {
        if (key.startsWith("session:") && is_workspace_chat_key(key.slice("session:".length), normalized_workspace_id)) {
          hydrated_navigation_keys_ref.current.delete(key);
        }
      }
      if (navigation.state_ref.current.active_workspace_id === normalized_workspace_id) {
        const next_workspace = next_workspaces.find((item) => item.workspace_id !== normalized_workspace_id);
        if (next_workspace) {
          navigation.set_active_workspace_id(next_workspace.workspace_id);
          localStorage.setItem(active_workspace_storage_key, next_workspace.workspace_id);
        } else {
          navigation.set_active_workspace_id("");
          localStorage.removeItem(active_workspace_storage_key);
        }
      }
    } catch (reason) {
      settings.set_error(to_error_message(reason));
      throw reason;
    }
  }, [catalog, chat_lifecycle, chat_stream, composer, navigation, session, settings]);

  const current_stores = useMemo<DesktopController["stores"]>(() => ({
    navigation: navigation.store,
    catalog: catalog.store,
    session: session.store,
    chat_stream: chat_stream.store,
    composer: composer.store,
    settings: settings.store,
    notification: notification.store,
  }), [catalog.store, chat_stream.store, composer.store, navigation.store, notification.store, session.store, settings.store]);

  const current_actions = useMemo<DesktopActions>(() => ({
    ...navigation_actions,
    ...group_actions,
    ...management,
    open_agent_chat,
    create_session,
    switch_draft_context,
    select_session,
    fork_session,
    rewrite_session_message,
    rename_session,
    archive_session,
    remove_session,
    clear_session_attach_request,
    rebind_session_workspace,
    create_workspace_for_session,
    load_archived_sessions,
    load_earlier_history,
    remove_workspace,
    update_draft,
    send_message,
    compact_session,
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
    clear_error: settings.clear_error,
  }), [archive_session, clear_session_attach_request, compact_session, create_session, create_workspace_for_session, fork_session, group_actions, load_archived_sessions, load_earlier_history, management, move_queued_message, navigation_actions, open_agent_chat, rebind_session_workspace, remove_queued_message, remove_session, remove_workspace, rename_session, respond_interaction, rewrite_session_message, select_session, send_message, send_queued_message, set_queue_paused, set_session_approval_mode, set_session_model, set_session_reasoning_effort, settings.clear_error, stop_session, switch_draft_context, toggle_queued_message_paused, update_draft, update_queued_message]);

  return {
    // 稳定句柄：组件用 use_desktop_selector 按最小切片订阅。
    stores: current_stores,
    actions: current_actions,
  };
}

/** 把孤儿 Session 从全部旧分组移除并放入新 Workspace 分组。 */
function rebind_entries(
  current: Record<string, DesktopWorkspaceSession[]>,
  agent_id: string,
  session_id: string,
  workspace_id: string,
  session: DesktopSessionSummary,
): Record<string, DesktopWorkspaceSession[]> {
  const next: Record<string, DesktopWorkspaceSession[]> = {};
  for (const [key, entries] of Object.entries(current)) {
    const remaining = entries.filter((item) => item.agent_id !== agent_id || item.session.session_id !== session_id);
    if (remaining.length > 0) next[key] = remaining;
  }
  (next[workspace_id] ??= []).push({ agent_id, session });
  return next;
}
