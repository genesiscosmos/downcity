/**
 * 当前Agent范围内的结果引用读取。
 * 有storage_id时只核对该记录；允许活动转归档但绝不猜多个归档。旧引用缺失UUID时
 * 只读活动地址或调用方本地复制事实，避免命中新建同逻辑归档。
 */
import type { SessionStore } from "@/types/store/SessionStore.js";
import type { SessionReadView } from "@/types/store/SessionReadView.js";

/** 记录归属仍由传入的同Agent Store保证，引用本身不是授权。 */
export async function read_result_session(store: SessionStore, session_id: string, category: string, storage_id?: string): Promise<SessionReadView> {
  if (storage_id) {
    try {
      const archived = await store.read_archived_session(storage_id);
      if (archived.metadata.session_id !== session_id || archived.metadata.origin.category !== category) throw new Error("result_unavailable_or_forbidden");
      return archived;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "session_not_found") throw error;
    }
  }
  const active = await store.read_session(session_id, category);
  if (storage_id && active.storage_id !== storage_id) throw new Error("result_unavailable_or_forbidden");
  return active;
}
