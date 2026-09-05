/**
 * Chat 请求与会话生命周期控制。
 *
 * 统一拥有快照去重、迟到响应失效、删除屏蔽和队列提交互斥状态。
 * 这些状态只描述 Renderer 内部的异步生命周期，不进入可渲染 store。
 */

import { useCallback, useMemo, useRef } from "react";
import { is_workspace_chat_key } from "@/features/chat/lib/chat_cache_key";

/** 创建 Chat 异步生命周期控制器。 */
export function use_chat_lifecycle() {
  const snapshot_request_ids_ref = useRef(new Map<string, number>());
  const snapshot_loads_ref = useRef(new Map<string, Promise<void>>());
  const deleting_session_keys_ref = useRef(new Set<string>());
  const deleted_session_keys_ref = useRef(new Set<string>());
  const processing_queue_keys_ref = useRef(new Set<string>());

  /** 判断会话是否正在删除或已经删除。 */
  const is_session_unavailable = useCallback((session_key: string) => (
    deleting_session_keys_ref.current.has(session_key)
    || deleted_session_keys_ref.current.has(session_key)
  ), []);

  /** 判断会话是否已经删除。 */
  const is_session_deleted = useCallback((session_key: string) => (
    deleted_session_keys_ref.current.has(session_key)
  ), []);

  /** 开始新快照请求，并使同一会话的旧响应失效。 */
  const begin_snapshot_request = useCallback((session_key: string): number => {
    const request_id = (snapshot_request_ids_ref.current.get(session_key) ?? 0) + 1;
    snapshot_request_ids_ref.current.set(session_key, request_id);
    return request_id;
  }, []);

  /** 判断快照响应仍属于当前有效请求。 */
  const is_snapshot_request_current = useCallback((session_key: string, request_id: number): boolean => (
    !is_session_unavailable(session_key)
    && snapshot_request_ids_ref.current.get(session_key) === request_id
  ), [is_session_unavailable]);

  /** 返回当前会话正在执行的快照读取。 */
  const get_snapshot_load = useCallback((session_key: string) => snapshot_loads_ref.current.get(session_key), []);

  /** 登记快照读取；完成时仅清理仍指向该 Promise 的条目。 */
  const set_snapshot_load = useCallback((session_key: string, loading: Promise<void>) => {
    snapshot_loads_ref.current.set(session_key, loading);
    const clear_loading = () => {
      if (snapshot_loads_ref.current.get(session_key) === loading) snapshot_loads_ref.current.delete(session_key);
    };
    void loading.then(clear_loading, clear_loading);
  }, []);

  /** 标记会话开始删除，并立即使所有既有快照响应失效。 */
  const begin_session_delete = useCallback((session_key: string) => {
    deleting_session_keys_ref.current.add(session_key);
    begin_snapshot_request(session_key);
  }, [begin_snapshot_request]);

  /** 完成会话删除并终止其 Renderer 内部异步生命周期。 */
  const finish_session_delete = useCallback((session_key: string) => {
    deleting_session_keys_ref.current.delete(session_key);
    deleted_session_keys_ref.current.add(session_key);
    processing_queue_keys_ref.current.delete(session_key);
    snapshot_loads_ref.current.delete(session_key);
  }, []);

  /** 删除失败后恢复会话可用状态。 */
  const cancel_session_delete = useCallback((session_key: string) => {
    deleting_session_keys_ref.current.delete(session_key);
  }, []);

  /** 屏蔽会话后续事件并清理其内部异步状态。 */
  const discard_session = useCallback((session_key: string) => {
    begin_snapshot_request(session_key);
    finish_session_delete(session_key);
  }, [begin_snapshot_request, finish_session_delete]);

  /** 尝试取得队列提交互斥权。 */
  const begin_queue_processing = useCallback((session_key: string): boolean => {
    if (is_session_unavailable(session_key) || processing_queue_keys_ref.current.has(session_key)) return false;
    processing_queue_keys_ref.current.add(session_key);
    return true;
  }, [is_session_unavailable]);

  /** 释放队列提交互斥权。 */
  const finish_queue_processing = useCallback((session_key: string) => {
    processing_queue_keys_ref.current.delete(session_key);
  }, []);

  /** 判断指定会话当前是否已有队列提交。 */
  const is_queue_processing = useCallback((session_key: string): boolean => (
    processing_queue_keys_ref.current.has(session_key)
  ), []);

  /** 移除 Workspace 下全部请求、删除屏蔽与队列互斥状态。 */
  const remove_workspace = useCallback((workspace_id: string) => {
    for (const key of snapshot_request_ids_ref.current.keys()) if (is_workspace_chat_key(key, workspace_id)) snapshot_request_ids_ref.current.delete(key);
    for (const key of snapshot_loads_ref.current.keys()) if (is_workspace_chat_key(key, workspace_id)) snapshot_loads_ref.current.delete(key);
    for (const key of deleting_session_keys_ref.current) if (is_workspace_chat_key(key, workspace_id)) deleting_session_keys_ref.current.delete(key);
    for (const key of deleted_session_keys_ref.current) if (is_workspace_chat_key(key, workspace_id)) deleted_session_keys_ref.current.delete(key);
    for (const key of processing_queue_keys_ref.current) if (is_workspace_chat_key(key, workspace_id)) processing_queue_keys_ref.current.delete(key);
  }, []);

  return useMemo(() => ({
    is_session_unavailable,
    is_session_deleted,
    begin_snapshot_request,
    is_snapshot_request_current,
    get_snapshot_load,
    set_snapshot_load,
    begin_session_delete,
    finish_session_delete,
    cancel_session_delete,
    discard_session,
    begin_queue_processing,
    finish_queue_processing,
    is_queue_processing,
    remove_workspace,
  }), [begin_queue_processing, begin_session_delete, begin_snapshot_request, cancel_session_delete, discard_session, finish_queue_processing, finish_session_delete, get_snapshot_load, is_queue_processing, is_session_deleted, is_session_unavailable, is_snapshot_request_current, remove_workspace, set_snapshot_load]);
}
