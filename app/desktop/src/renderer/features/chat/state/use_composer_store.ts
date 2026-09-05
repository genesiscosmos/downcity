/**
 * 输入编排领域 store（composer）。
 *
 * 承载按 Session 组合键隔离的 Tiptap 输入草稿、待发送队列与队列暂停状态。
 * 这些是 Renderer 交互状态，不写回 canonical 消息。
 */

import { useCallback, useMemo } from "react";
import type { JSONContent } from "@tiptap/core";
import type { ComposerStoreState, QueuedChatMessage } from "@/types/DesktopView";
import { is_chat_busy } from "@/types/DesktopView";
import { create_chat_composer } from "@/features/chat/composer/editor/chatComposerCodec";
import { get_workspace_chat_key_prefixes } from "@/features/chat/lib/chat_cache_key";
import { use_store } from "@/lib/store";
import { remove_record_prefixes } from "@/lib/store/record_projection";

const initial_composer_state: ComposerStoreState = {
  draft_content_by_session: {},
  queued_messages_by_session: {},
  queue_paused_by_session: {},
};

/** 从 Record 移除一个键；不存在时保留原引用。 */
function remove_key<Value>(current: Record<string, Value>, key: string): Record<string, Value> {
  if (!(key in current)) return current;
  const next = { ...current };
  delete next[key];
  return next;
}

/** 将一项 Draft 状态移动到新组合键，避免切换上下文后留下过期副本。 */
function move_draft_value<Value>(
  current: Record<string, Value>,
  source_key: string,
  target_key: string,
  fallback: Value,
): Record<string, Value> {
  const next = { ...current, [target_key]: current[source_key] ?? fallback };
  delete next[source_key];
  return next;
}

/** 创建输入编排领域 store。 */
export function use_composer_store() {
  const { store, state_ref, commit } = use_store<ComposerStoreState>(initial_composer_state);

  /** 写入指定 Session 的完整输入草稿。 */
  const set_draft = useCallback((session_key: string, draft: JSONContent) => {
    const current = state_ref.current;
    if (Object.is(current.draft_content_by_session[session_key], draft)) return;
    commit({
      ...current,
      draft_content_by_session: { ...current.draft_content_by_session, [session_key]: draft },
    });
  }, [commit]);

  /** 移除指定 Session 的输入草稿。 */
  const remove_draft = useCallback((session_key: string) => {
    const current = state_ref.current;
    if (!(session_key in current.draft_content_by_session)) return;
    commit({
      ...current,
      draft_content_by_session: remove_key(current.draft_content_by_session, session_key),
    });
  }, [commit]);

  /** 将输入草稿从旧键迁移到新键（切换上下文时使用）。 */
  const move_draft = useCallback((source_key: string, target_key: string) => {
    const current = state_ref.current;
    commit({
      ...current,
      draft_content_by_session: move_draft_value(
        current.draft_content_by_session,
        source_key,
        target_key,
        create_chat_composer(),
      ),
    });
  }, [commit]);

  /** 在指定 Session 队列末尾追加一条消息。 */
  const append_queued = useCallback((session_key: string, queued: QueuedChatMessage) => {
    const current = state_ref.current;
    commit({
      ...current,
      queued_messages_by_session: {
        ...current.queued_messages_by_session,
        [session_key]: [...(current.queued_messages_by_session[session_key] ?? []), queued],
      },
    });
  }, [commit]);

  /** 替换指定 Session 的整个队列。 */
  const replace_queue = useCallback((session_key: string, queue: QueuedChatMessage[]) => {
    const current = state_ref.current;
    if (Object.is(current.queued_messages_by_session[session_key], queue)) return;
    commit({
      ...current,
      queued_messages_by_session: { ...current.queued_messages_by_session, [session_key]: queue },
    });
  }, [commit]);

  /** 整体替换全部队列（队列提交循环 / 批量清理时使用）。 */
  const replace_all_queue = useCallback((next: Record<string, QueuedChatMessage[]>) => {
    const current = state_ref.current;
    if (current.queued_messages_by_session === next) return;
    commit({ ...current, queued_messages_by_session: next });
  }, [commit]);

  /** 移除指定 Session 的整个队列。 */
  const remove_queue = useCallback((session_key: string) => {
    const current = state_ref.current;
    if (!(session_key in current.queued_messages_by_session)) return;
    commit({
      ...current,
      queued_messages_by_session: remove_key(current.queued_messages_by_session, session_key),
    });
  }, [commit]);

  /** 移除一个 Workspace 下的全部草稿、队列与暂停状态。 */
  const remove_workspace = useCallback((workspace_id: string) => {
    const current = state_ref.current;
    const prefixes = get_workspace_chat_key_prefixes(workspace_id);
    const next_drafts = remove_record_prefixes(current.draft_content_by_session, prefixes);
    const next_queue = remove_record_prefixes(current.queued_messages_by_session, prefixes);
    const next_paused = remove_record_prefixes(current.queue_paused_by_session, prefixes);
    if (next_drafts === current.draft_content_by_session && next_queue === current.queued_messages_by_session && next_paused === current.queue_paused_by_session) return;
    commit({
      ...current,
      draft_content_by_session: next_drafts,
      queued_messages_by_session: next_queue,
      queue_paused_by_session: next_paused,
    });
  }, [commit]);

  /** 写入指定 Session 的队列暂停状态。 */
  const set_queue_paused = useCallback((session_key: string, paused: boolean) => {
    const current = state_ref.current;
    if ((current.queue_paused_by_session[session_key] ?? false) === paused) return;
    commit({
      ...current,
      queue_paused_by_session: { ...current.queue_paused_by_session, [session_key]: paused },
    });
  }, [commit]);

  /** 移除指定 Session 的队列暂停状态。 */
  const remove_queue_paused = useCallback((session_key: string) => {
    const current = state_ref.current;
    if (!(session_key in current.queue_paused_by_session)) return;
    commit({
      ...current,
      queue_paused_by_session: remove_key(current.queue_paused_by_session, session_key),
    });
  }, [commit]);

  /** 判断指定 Session 当前是否可提交下一条队列消息。 */
  const can_process_queue = useCallback((
    session_key: string,
    chat_runtime: import("@common/types/DesktopApi").DesktopChatRuntime | undefined,
  ) => {
    const queue = state_ref.current.queued_messages_by_session[session_key];
    return Boolean(
      queue?.[0] && !queue[0].paused && !state_ref.current.queue_paused_by_session[session_key]
      && !is_chat_busy(chat_runtime),
    );
  }, []);

  return useMemo(() => ({
    store,
    state_ref,
    set_draft,
    remove_draft,
    move_draft,
    append_queued,
    replace_queue,
    replace_all_queue,
    remove_queue,
    remove_workspace,
    set_queue_paused,
    remove_queue_paused,
    can_process_queue,
  }), [append_queued, can_process_queue, move_draft, remove_draft, remove_queue, remove_queue_paused, remove_workspace, replace_all_queue, replace_queue, set_draft, set_queue_paused, state_ref, store]);
}
