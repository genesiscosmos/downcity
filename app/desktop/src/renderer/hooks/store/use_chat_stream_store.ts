/**
 * Chat 流式领域 store（高频热路径）。
 *
 * 承载 Session 消息 / 运行态 / 文件改动摘要 / 会话配置 / 历史分页，
 * 以及 Group 的共享消息与成员运行态。mutation 通过 requestAnimationFrame
 * 批处理合并，避免每条 IPC 事件触发一次整表 setState。
 */

import { useCallback, useMemo, useRef } from "react";
import type { SessionMessage, SessionMutation, SessionTurnFileDiffSummary } from "@downcity/agent";
import type {
  DesktopChatRuntime,
  DesktopGroupMessage,
  DesktopGroupMemberRuntime,
  DesktopGroupStatusPhase,
  DesktopSessionConfiguration,
} from "@common/types/DesktopApi";
import type { ChatHistoryState, ChatStreamState, GroupInteraction } from "@/types/DesktopView";
import type { SessionMessageIndex } from "@/types/SessionProjection";
import type { GroupMessageProjection } from "@/types/GroupProjection";
import {
  apply_indexed_session_mutations,
  create_session_message_index,
  merge_session_snapshot,
} from "@/lib/chat/session_mutation";
import { collect_executing_agent_ids, project_executing_agent_ids } from "@/lib/chat/chat_runtime_projection";
import { get_workspace_chat_key_prefixes } from "@/lib/chat/chat_cache_key";
import { project_chat_render_cache, recent_chat_render_cache_limit, touch_chat_render_cache } from "@/lib/chat/chat_render_cache";
import { same_group_member_statuses } from "@/lib/group/group_runtime_projection";
import {
  append_group_messages_projection,
  create_empty_group_message_projection,
  create_group_message_projection,
  mark_group_message_read,
} from "@/lib/group/group_message_projection";
import { remove_record_prefixes } from "@/lib/store/record_projection";
import { use_store } from "./store_types";

const initial_chat_stream_state: ChatStreamState = {
  messages_by_session: {},
  chat_runtime_by_session: {},
  file_diff_by_session: {},
  configuration_by_session: {},
  history_by_session: {},
  executing_agent_ids: new Set(),
  group_message_projection_by_group: {},
  group_member_statuses_by_group: {},
  group_phase_by_group: {},
  group_interactions_by_group: {},
};

/** 从 Record 移除一个键；不存在时保留原引用。 */
function remove_key<Value>(current: Record<string, Value>, key: string): Record<string, Value> {
  if (!(key in current)) return current;
  const next = { ...current };
  delete next[key];
  return next;
}

/** 创建 Chat 流式领域 store。 */
export function use_chat_stream_store() {
  const { store, state_ref, commit } = use_store<ChatStreamState>(initial_chat_stream_state);
  const mutation_batches_ref = useRef(new Map<string, SessionMutation[]>());
  const mutation_frame_ref = useRef<number | null>(null);
  const group_message_batches_ref = useRef(new Map<string, DesktopGroupMessage[]>());
  const group_message_frame_ref = useRef<number | null>(null);
  const hydrated_render_cache_keys_ref = useRef(new Set<string>());
  const pending_snapshot_counts_ref = useRef(new Map<string, number>());
  const recent_render_cache_keys_ref = useRef<readonly string[]>([]);
  const message_indexes_ref = useRef(new Map<string, SessionMessageIndex>());

  /** 判断指定 Session 是否已有完整快照，或正在等待快照期间允许接收实时增量。 */
  const can_receive_render_event = useCallback((session_key: string) => {
    return hydrated_render_cache_keys_ref.current.has(session_key)
      || (pending_snapshot_counts_ref.current.get(session_key) ?? 0) > 0;
  }, []);

  /** 原子移除指定 Session 的全部可重建渲染缓存。 */
  const evict_render_cache = useCallback((session_keys: readonly string[]) => {
    if (session_keys.length === 0) return;
    const keys = new Set(session_keys);
    const current = state_ref.current;
    const next_messages = remove_keys(current.messages_by_session, keys);
    const next_file_diff = remove_keys(current.file_diff_by_session, keys);
    const next_history = remove_keys(current.history_by_session, keys);
    for (const session_key of keys) {
      hydrated_render_cache_keys_ref.current.delete(session_key);
      mutation_batches_ref.current.delete(session_key);
      message_indexes_ref.current.delete(session_key);
    }
    recent_render_cache_keys_ref.current = recent_render_cache_keys_ref.current.filter((key) => !keys.has(key));
    if (
      next_messages === current.messages_by_session
      && next_file_diff === current.file_diff_by_session
      && next_history === current.history_by_session
    ) return;
    commit({
      ...current,
      messages_by_session: next_messages,
      file_diff_by_session: next_file_diff,
      history_by_session: next_history,
    });
  }, [commit]);

  /** 标记一次 canonical snapshot 请求开始，并把 Session 提升为最近访问项。 */
  const begin_session_snapshot = useCallback((session_key: string) => {
    const current_count = pending_snapshot_counts_ref.current.get(session_key) ?? 0;
    pending_snapshot_counts_ref.current.set(session_key, current_count + 1);
    recent_render_cache_keys_ref.current = touch_chat_render_cache(recent_render_cache_keys_ref.current, session_key);
  }, []);

  /**
   * 收口一次 canonical snapshot 请求。
   *
   * 全部并发请求失败且从未合并完整快照时，删除请求期间收到的残缺 mutation。
   */
  const finish_session_snapshot = useCallback((session_key: string, succeeded: boolean) => {
    const current_count = pending_snapshot_counts_ref.current.get(session_key) ?? 0;
    if (current_count <= 1) pending_snapshot_counts_ref.current.delete(session_key);
    else pending_snapshot_counts_ref.current.set(session_key, current_count - 1);
    if (succeeded || pending_snapshot_counts_ref.current.has(session_key) || hydrated_render_cache_keys_ref.current.has(session_key)) return;
    evict_render_cache([session_key]);
  }, [evict_render_cache]);

  /** 保留激活 Session 与最近 Session，并淘汰超出容量的可重建渲染缓存。 */
  const trim_render_cache = useCallback((active_session_key?: string) => {
    const protected_session_keys = new Set(pending_snapshot_counts_ref.current.keys());
    if (active_session_key) protected_session_keys.add(active_session_key);
    const projection = project_chat_render_cache({
      cached_session_keys: Object.keys(state_ref.current.messages_by_session),
      recent_session_keys: recent_render_cache_keys_ref.current,
      protected_session_keys,
      recent_cache_limit: recent_chat_render_cache_limit,
    });
    recent_render_cache_keys_ref.current = projection.recent_session_keys;
    evict_render_cache(projection.evicted_session_keys);
  }, [evict_render_cache]);

  /** 将一条 mutation 加入 rAF 批处理；同一帧内合并应用。 */
  const enqueue_mutation = useCallback((session_key: string, mutation: SessionMutation) => {
    if (!can_receive_render_event(session_key)) return;
    const batch = mutation_batches_ref.current.get(session_key) ?? [];
    batch.push(mutation);
    mutation_batches_ref.current.set(session_key, batch);
    if (mutation_frame_ref.current !== null) return;
    mutation_frame_ref.current = requestAnimationFrame(() => {
      const batches = mutation_batches_ref.current;
      mutation_batches_ref.current = new Map();
      mutation_frame_ref.current = null;
      const current = state_ref.current;
      const next_messages = { ...current.messages_by_session };
      let changed = false;
      for (const [key, mutations] of batches) {
        const current_messages = next_messages[key] ?? [];
        const current_index = message_indexes_ref.current.get(key) ?? create_session_message_index(current_messages);
        const result = apply_indexed_session_mutations(current_messages, current_index, mutations);
        message_indexes_ref.current.set(key, result.message_index);
        if (result.messages === current_messages) continue;
        next_messages[key] = result.messages;
        changed = true;
      }
      if (!changed) return;
      commit({ ...current, messages_by_session: next_messages });
    });
  }, [can_receive_render_event, commit]);

  /** 卸载时取消尚未执行的 Session mutation 与 Group 消息批处理。 */
  const cancel_pending_mutations = useCallback(() => {
    if (mutation_frame_ref.current !== null) cancelAnimationFrame(mutation_frame_ref.current);
    if (group_message_frame_ref.current !== null) cancelAnimationFrame(group_message_frame_ref.current);
    mutation_frame_ref.current = null;
    group_message_frame_ref.current = null;
    mutation_batches_ref.current = new Map();
    group_message_batches_ref.current = new Map();
  }, []);

  /** 将快照消息合并进指定 Session（snapshot merge 语义）。 */
  const merge_messages = useCallback((session_key: string, messages: SessionMessage[]) => {
    const current = state_ref.current;
    const current_messages = current.messages_by_session[session_key] ?? [];
    const merged_messages = merge_session_snapshot(current_messages, messages);
    hydrated_render_cache_keys_ref.current.add(session_key);
    recent_render_cache_keys_ref.current = touch_chat_render_cache(recent_render_cache_keys_ref.current, session_key);
    if (merged_messages === current_messages) {
      if (!message_indexes_ref.current.has(session_key)) {
        message_indexes_ref.current.set(session_key, create_session_message_index(merged_messages));
      }
      return;
    }
    message_indexes_ref.current.set(session_key, create_session_message_index(merged_messages));
    commit({
      ...current,
      messages_by_session: {
        ...current.messages_by_session,
        [session_key]: merged_messages,
      },
    });
  }, [commit]);

  /** 移除指定 Session 的消息缓存。 */
  const remove_messages = useCallback((session_key: string) => {
    pending_snapshot_counts_ref.current.delete(session_key);
    evict_render_cache([session_key]);
  }, [evict_render_cache]);

  /** 写入指定 Session 的实时运行态，并刷新 executing 标记与 Agent 集合。 */
  const set_runtime = useCallback((session_key: string, runtime: DesktopChatRuntime) => {
    const current = state_ref.current;
    if (Object.is(current.chat_runtime_by_session[session_key], runtime)) return;
    const next_agent_ids = project_executing_agent_ids(current.executing_agent_ids, current.chat_runtime_by_session, session_key, runtime);
    commit({
      ...current,
      chat_runtime_by_session: { ...current.chat_runtime_by_session, [session_key]: runtime },
      executing_agent_ids: next_agent_ids,
    });
  }, [commit]);

  /** 移除指定 Session 的运行态、executing 标记与 Agent 集合条目。 */
  const remove_runtime = useCallback((session_key: string) => {
    const current = state_ref.current;
    if (!(session_key in current.chat_runtime_by_session)) return;
    const next_agent_ids = project_executing_agent_ids(current.executing_agent_ids, current.chat_runtime_by_session, session_key);
    commit({
      ...current,
      chat_runtime_by_session: remove_key(current.chat_runtime_by_session, session_key),
      executing_agent_ids: next_agent_ids,
    });
  }, [commit]);

  /** 写入指定 Session 的最新实时文件改动摘要。 */
  const set_file_diff = useCallback((session_key: string, diff: SessionTurnFileDiffSummary) => {
    if (!can_receive_render_event(session_key)) return;
    const current = state_ref.current;
    const previous = current.file_diff_by_session[session_key];
    if (previous?.files_count === diff.files_count && previous.additions === diff.additions && previous.deletions === diff.deletions) return;
    commit({
      ...current,
      file_diff_by_session: { ...current.file_diff_by_session, [session_key]: diff },
    });
  }, [can_receive_render_event, commit]);

  /** 移除指定 Session 的文件改动摘要。 */
  const remove_file_diff = useCallback((session_key: string) => {
    const current = state_ref.current;
    if (!(session_key in current.file_diff_by_session)) return;
    commit({ ...current, file_diff_by_session: remove_key(current.file_diff_by_session, session_key) });
  }, [commit]);

  /** 写入指定 Session 的模型与审批配置。 */
  const set_configuration = useCallback((session_key: string, configuration: DesktopSessionConfiguration) => {
    const current = state_ref.current;
    const previous = current.configuration_by_session[session_key];
    if (previous?.model_id === configuration.model_id && previous.reasoning_effort === configuration.reasoning_effort && previous.approval_mode === configuration.approval_mode) return;
    commit({
      ...current,
      configuration_by_session: { ...current.configuration_by_session, [session_key]: configuration },
    });
  }, [commit]);

  /** 移除指定 Session 的配置缓存。 */
  const remove_configuration = useCallback((session_key: string) => {
    const current = state_ref.current;
    if (!(session_key in current.configuration_by_session)) return;
    commit({ ...current, configuration_by_session: remove_key(current.configuration_by_session, session_key) });
  }, [commit]);

  /** 将配置从旧键迁移到新键（切换 Draft 上下文时使用）。 */
  const move_configuration = useCallback((source_key: string, target_key: string, fallback: DesktopSessionConfiguration) => {
    const current = state_ref.current;
    const next = { ...current.configuration_by_session, [target_key]: current.configuration_by_session[source_key] ?? fallback };
    delete next[source_key];
    commit({ ...current, configuration_by_session: next });
  }, [commit]);

  /** 写入指定 Session 的历史分页状态。 */
  const set_history = useCallback((session_key: string, history: ChatHistoryState) => {
    const current = state_ref.current;
    const previous = current.history_by_session[session_key];
    if (previous?.loading === history.loading && previous.has_more === history.has_more && previous.next_before_sequence === history.next_before_sequence) return;
    commit({
      ...current,
      history_by_session: { ...current.history_by_session, [session_key]: history },
    });
  }, [commit]);

  /** 移除指定 Session 的历史分页状态。 */
  const remove_history = useCallback((session_key: string) => {
    const current = state_ref.current;
    if (!(session_key in current.history_by_session)) return;
    commit({ ...current, history_by_session: remove_key(current.history_by_session, session_key) });
  }, [commit]);

  /** 替换 Group 的共享消息缓存。 */
  const set_group_messages = useCallback((group_id: string, messages: DesktopGroupMessage[]) => {
    const current = state_ref.current;
    commit({
      ...current,
      group_message_projection_by_group: {
        ...current.group_message_projection_by_group,
        [group_id]: create_group_message_projection(messages),
      },
    });
  }, [commit]);

  /** 追加一条 Group 共享消息。 */
  const append_group_message = useCallback((group_id: string, message: DesktopGroupMessage) => {
    const batch = group_message_batches_ref.current.get(group_id) ?? [];
    batch.push(message);
    group_message_batches_ref.current.set(group_id, batch);
    if (group_message_frame_ref.current !== null) return;
    group_message_frame_ref.current = requestAnimationFrame(() => {
      const batches = group_message_batches_ref.current;
      group_message_batches_ref.current = new Map();
      group_message_frame_ref.current = null;
      const current = state_ref.current;
      let next_projections = current.group_message_projection_by_group;
      for (const [target_group_id, messages] of batches) {
        const current_projection = next_projections[target_group_id] ?? create_empty_group_message_projection();
        const next_projection = append_group_messages_projection(current_projection, messages);
        if (next_projection === current_projection) continue;
        if (next_projections === current.group_message_projection_by_group) next_projections = { ...next_projections };
        next_projections[target_group_id] = next_projection;
      }
      if (next_projections !== current.group_message_projection_by_group) {
        commit({ ...current, group_message_projection_by_group: next_projections });
      }
    });
  }, [commit]);

  /** 替换 Group 的成员运行态（只保留正在运行的成员）。 */
  const set_group_member_statuses = useCallback((group_id: string, statuses: DesktopGroupMemberRuntime[]) => {
    const current = state_ref.current;
    if (same_group_member_statuses(current.group_member_statuses_by_group[group_id], statuses)) return;
    commit({
      ...current,
      group_member_statuses_by_group: { ...current.group_member_statuses_by_group, [group_id]: statuses },
    });
  }, [commit]);

  /** 原子写入 Group 的成员运行态与当前阶段。 */
  const set_group_status = useCallback((group_id: string, statuses: DesktopGroupMemberRuntime[], phase: DesktopGroupStatusPhase) => {
    const current = state_ref.current;
    const statuses_unchanged = same_group_member_statuses(current.group_member_statuses_by_group[group_id], statuses);
    const phase_unchanged = current.group_phase_by_group[group_id] === phase;
    if (statuses_unchanged && phase_unchanged) return;
    commit({
      ...current,
      group_member_statuses_by_group: statuses_unchanged ? current.group_member_statuses_by_group : { ...current.group_member_statuses_by_group, [group_id]: statuses },
      group_phase_by_group: phase_unchanged ? current.group_phase_by_group : { ...current.group_phase_by_group, [group_id]: phase },
    });
  }, [commit]);

  /** 追加一个已完成 Dispatch 的消息标识（去重）。 */
  const add_group_read_id = useCallback((group_id: string, message_id: string) => {
    const current = state_ref.current;
    const current_projection = current.group_message_projection_by_group[group_id] ?? create_empty_group_message_projection();
    const next_projection = mark_group_message_read(current_projection, message_id);
    if (next_projection === current_projection) return;
    commit({
      ...current,
      group_message_projection_by_group: {
        ...current.group_message_projection_by_group,
        [group_id]: next_projection,
      },
    });
  }, [commit]);

  /** 追加或覆盖一个待响应的成员交互（按 interaction_id 去重）。 */
  const upsert_group_interaction = useCallback((group_id: string, interaction: GroupInteraction) => {
    const current = state_ref.current;
    const interaction_id = interaction.part.interaction_id;
    const existing = current.group_interactions_by_group[group_id] ?? [];
    commit({
      ...current,
      group_interactions_by_group: {
        ...current.group_interactions_by_group,
        [group_id]: [
          ...existing.filter((item) => item.part.interaction_id !== interaction_id),
          interaction,
        ],
      },
    });
  }, [commit]);

  /** 移除指定 interaction_id 的待响应交互。 */
  const remove_group_interaction = useCallback((group_id: string, interaction_id: string) => {
    const current = state_ref.current;
    const existing = current.group_interactions_by_group[group_id] ?? [];
    const next = existing.filter((item) => item.part.interaction_id !== interaction_id);
    if (next.length === existing.length) return;
    commit({
      ...current,
      group_interactions_by_group: {
        ...current.group_interactions_by_group,
        [group_id]: next,
      },
    });
  }, [commit]);

  /** 清空 Group 的一次性运行上下文（切换 GroupSession / 新建时调用）。 */
  const reset_group_chat = useCallback((group_id: string) => {
    group_message_batches_ref.current.delete(group_id);
    const current = state_ref.current;
    const empty_projection: GroupMessageProjection = create_empty_group_message_projection();
    commit({
      ...current,
      group_message_projection_by_group: {
        ...current.group_message_projection_by_group,
        [group_id]: empty_projection,
      },
      group_member_statuses_by_group: { ...current.group_member_statuses_by_group, [group_id]: [] },
      group_phase_by_group: { ...current.group_phase_by_group, [group_id]: "idle" },
      group_interactions_by_group: { ...current.group_interactions_by_group, [group_id]: [] },
    });
  }, [commit]);

  /** 移除 Group 在 Chat 流式领域的全部缓存。 */
  const remove_group = useCallback((group_id: string) => {
    group_message_batches_ref.current.delete(group_id);
    const current = state_ref.current;
    commit({
      ...current,
      group_message_projection_by_group: remove_key(current.group_message_projection_by_group, group_id),
      group_member_statuses_by_group: remove_key(current.group_member_statuses_by_group, group_id),
      group_phase_by_group: remove_key(current.group_phase_by_group, group_id),
      group_interactions_by_group: remove_key(current.group_interactions_by_group, group_id),
    });
  }, [commit]);

  /** 移除一个 Workspace 下的全部 Session 缓存（messages / runtime / config / history / diff）。 */
  const remove_workspace = useCallback((workspace_id: string) => {
    const current = state_ref.current;
    const prefixes = get_workspace_chat_key_prefixes(workspace_id);
    const next_messages = remove_record_prefixes(current.messages_by_session, prefixes);
    const next_runtime = remove_record_prefixes(current.chat_runtime_by_session, prefixes);
    const next_file_diff = remove_record_prefixes(current.file_diff_by_session, prefixes);
    const next_configuration = remove_record_prefixes(current.configuration_by_session, prefixes);
    const next_history = remove_record_prefixes(current.history_by_session, prefixes);
    const matches_workspace = (key: string) => prefixes.some((prefix) => key.startsWith(prefix));
    for (const key of hydrated_render_cache_keys_ref.current) {
      if (matches_workspace(key)) hydrated_render_cache_keys_ref.current.delete(key);
    }
    for (const key of pending_snapshot_counts_ref.current.keys()) {
      if (matches_workspace(key)) pending_snapshot_counts_ref.current.delete(key);
    }
    for (const key of mutation_batches_ref.current.keys()) {
      if (matches_workspace(key)) mutation_batches_ref.current.delete(key);
    }
    for (const key of message_indexes_ref.current.keys()) {
      if (matches_workspace(key)) message_indexes_ref.current.delete(key);
    }
    recent_render_cache_keys_ref.current = recent_render_cache_keys_ref.current.filter((key) => !matches_workspace(key));
    if (
      next_messages === current.messages_by_session && next_runtime === current.chat_runtime_by_session
      && next_file_diff === current.file_diff_by_session && next_configuration === current.configuration_by_session
      && next_history === current.history_by_session
    ) return;
    const next_agent_ids = next_runtime === current.chat_runtime_by_session
      ? current.executing_agent_ids
      : collect_executing_agent_ids(next_runtime);
    commit({
      ...current,
      messages_by_session: next_messages,
      chat_runtime_by_session: next_runtime,
      executing_agent_ids: next_agent_ids,
      file_diff_by_session: next_file_diff,
      configuration_by_session: next_configuration,
      history_by_session: next_history,
    });
  }, [commit]);

  return useMemo(() => ({
    store,
    state_ref,
    begin_session_snapshot,
    finish_session_snapshot,
    trim_render_cache,
    enqueue_mutation,
    cancel_pending_mutations,
    merge_messages,
    remove_messages,
    set_runtime,
    remove_runtime,
    set_file_diff,
    remove_file_diff,
    set_configuration,
    remove_configuration,
    move_configuration,
    set_history,
    remove_history,
    set_group_messages,
    append_group_message,
    set_group_member_statuses,
    set_group_status,
    add_group_read_id,
    upsert_group_interaction,
    remove_group_interaction,
    reset_group_chat,
    remove_group,
    remove_workspace,
  }), [add_group_read_id, append_group_message, begin_session_snapshot, cancel_pending_mutations, enqueue_mutation, finish_session_snapshot, merge_messages, move_configuration, remove_configuration, remove_file_diff, remove_group, remove_group_interaction, remove_history, remove_messages, remove_runtime, remove_workspace, reset_group_chat, set_configuration, set_file_diff, set_group_member_statuses, set_group_messages, set_group_status, set_history, set_runtime, state_ref, store, trim_render_cache, upsert_group_interaction]);
}

/** 从 Record 原子移除一组键；没有命中时保留原引用。 */
function remove_keys<Value>(current: Record<string, Value>, keys: ReadonlySet<string>): Record<string, Value> {
  if (![...keys].some((key) => key in current)) return current;
  const next = { ...current };
  for (const key of keys) delete next[key];
  return next;
}
