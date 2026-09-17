/**
 * 输入编排领域 store（composer）。
 *
 * 承载按 Session 组合键隔离的 Tiptap 输入草稿、待发送队列与队列暂停状态。
 * 这些是 Renderer 交互状态，不写回 canonical 消息。
 */

import { useCallback, useMemo, useRef } from "react";
import type { JSONContent } from "@tiptap/core";
import type { ComposerStoreState, QueuedChatMessage } from "@/types/DesktopView";
import { is_chat_busy } from "@/types/DesktopView";
import { create_chat_composer, is_chat_composer_empty } from "@/features/chat/composer/editor/chatComposerCodec";
import { request_composer_focus } from "@/features/chat/composer/editor/composerFocus";
import { chat_composer_storage } from "@/features/chat/composer/storage/chatComposerStorage";
import { get_workspace_chat_key_prefixes } from "@/features/chat/lib/chat_cache_key";
import { use_store } from "@/lib/store";
import { remove_record_prefixes } from "@/lib/store/record_projection";

const initial_composer_state: ComposerStoreState = {
  draft_content_by_session: {},
  queued_messages_by_session: {},
  queue_paused_by_session: {},
  focus_request_by_session: {},
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

/** 异步保存非空队列，空队列则删除持久化记录。 */
function persist_queue(session_key: string, queue: QueuedChatMessage[]): void {
  const persistence = queue.length > 0
    ? chat_composer_storage.save_queue(session_key, queue)
    : chat_composer_storage.remove_queue(session_key);
  void persistence.catch(() => undefined);
}

/** 创建输入编排领域 store。 */
export function use_composer_store() {
  const { store, state_ref, commit } = use_store<ComposerStoreState>(initial_composer_state);
  const hydration_promise_ref = useRef<Promise<void> | undefined>(undefined);

  /** 从 IndexedDB 恢复草稿与队列；恢复队列统一暂停，运行中内存状态拥有更高优先级。 */
  const hydrate_composer = useCallback(() => {
    if (hydration_promise_ref.current) return hydration_promise_ref.current;
    hydration_promise_ref.current = chat_composer_storage.load().then((persisted) => {
      const persisted_queue_keys = Object.keys(persisted.queued_messages_by_session);
      if (Object.keys(persisted.draft_content_by_session).length === 0 && persisted_queue_keys.length === 0) return;
      const current = state_ref.current;
      commit({
        ...current,
        draft_content_by_session: { ...persisted.draft_content_by_session, ...current.draft_content_by_session },
        queued_messages_by_session: { ...persisted.queued_messages_by_session, ...current.queued_messages_by_session },
        queue_paused_by_session: {
          ...persisted.queue_paused_by_session,
          ...current.queue_paused_by_session,
        },
      });
    }).catch(() => undefined);
    return hydration_promise_ref.current;
  }, [commit]);

  /** 写入指定 Session 的完整输入草稿。 */
  const set_draft = useCallback((session_key: string, draft: JSONContent) => {
    const persistence = is_chat_composer_empty(draft)
      ? chat_composer_storage.remove_draft(session_key)
      : chat_composer_storage.save_draft(session_key, draft);
    void persistence.catch(() => undefined);
    const current = state_ref.current;
    if (Object.is(current.draft_content_by_session[session_key], draft)) return;
    commit({
      ...current,
      draft_content_by_session: { ...current.draft_content_by_session, [session_key]: draft },
    });
  }, [commit]);

  /** 移除指定 Session 的输入草稿。 */
  const remove_draft = useCallback((session_key: string) => {
    void chat_composer_storage.remove_draft(session_key).catch(() => undefined);
    const current = state_ref.current;
    if (!(session_key in current.draft_content_by_session)) return;
    commit({
      ...current,
      draft_content_by_session: remove_key(current.draft_content_by_session, session_key),
    });
  }, [commit]);

  /** 请求指定对话的输入框获得键盘焦点；序号递增，因此同一对话重复请求仍然生效。 */
  const request_focus = useCallback((session_key: string) => {
    const current = state_ref.current;
    commit({
      ...current,
      focus_request_by_session: request_composer_focus(current.focus_request_by_session, session_key),
    });
  }, [commit]);

  /** 将输入草稿从旧键迁移到新键（切换上下文时使用）。 */
  const move_draft = useCallback((source_key: string, target_key: string) => {
    void chat_composer_storage.move_draft(source_key, target_key).catch(() => undefined);
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
    const next_queue = [...(current.queued_messages_by_session[session_key] ?? []), queued];
    persist_queue(session_key, next_queue);
    commit({
      ...current,
      queued_messages_by_session: {
        ...current.queued_messages_by_session,
        [session_key]: next_queue,
      },
    });
  }, [commit]);

  /** 替换指定 Session 的整个队列。 */
  const replace_queue = useCallback((session_key: string, queue: QueuedChatMessage[]) => {
    persist_queue(session_key, queue);
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
    const changed_keys = new Set([...Object.keys(current.queued_messages_by_session), ...Object.keys(next)]);
    for (const session_key of changed_keys) {
      const queue = next[session_key] ?? [];
      if (Object.is(current.queued_messages_by_session[session_key], queue)) continue;
      persist_queue(session_key, queue);
    }
    commit({ ...current, queued_messages_by_session: next });
  }, [commit]);

  /** 移除指定 Session 的整个队列。 */
  const remove_queue = useCallback((session_key: string) => {
    void chat_composer_storage.remove_queue(session_key).catch(() => undefined);
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
    void chat_composer_storage.remove_prefixes(prefixes).catch(() => undefined);
    const next_drafts = remove_record_prefixes(current.draft_content_by_session, prefixes);
    const next_queue = remove_record_prefixes(current.queued_messages_by_session, prefixes);
    const next_paused = remove_record_prefixes(current.queue_paused_by_session, prefixes);
    const next_focus = remove_record_prefixes(current.focus_request_by_session, prefixes);
    if (next_drafts === current.draft_content_by_session && next_queue === current.queued_messages_by_session && next_paused === current.queue_paused_by_session && next_focus === current.focus_request_by_session) return;
    commit({
      ...current,
      draft_content_by_session: next_drafts,
      queued_messages_by_session: next_queue,
      queue_paused_by_session: next_paused,
      focus_request_by_session: next_focus,
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
    hydrate_composer,
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
    request_focus,
  }), [append_queued, can_process_queue, hydrate_composer, move_draft, remove_draft, remove_queue, remove_queue_paused, remove_workspace, replace_all_queue, replace_queue, request_focus, set_draft, set_queue_paused, state_ref, store]);
}
