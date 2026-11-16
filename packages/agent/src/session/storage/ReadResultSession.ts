/**
 * 当前Agent范围内的结果引用读取。
 * 永久 UUID 在活动和归档状态都指向同一会话；分类用于一致性校验。
 * 只在明确不存在活动记录时检查归档，存储失败继续抛出，引用本身不授予权限。
 */
import type { SessionStore } from "@/types/store/SessionStore.js";
import type { SessionReadView } from "@/types/store/SessionReadView.js";

/** 记录归属仍由传入的同Agent Store保证，引用本身不是授权。 */
export async function read_result_session(store: SessionStore, session_id: string, category: string): Promise<SessionReadView> {
  try { return await store.read_session(session_id, category); }
  catch (error) {
    if (!(error instanceof Error) || error.message !== "session_not_found") throw error;
  }
  const archived = await store.read_archived_session(session_id);
  if (archived.metadata.origin.category !== category) throw new Error("result_unavailable_or_forbidden");
  return archived;
}
