/**
 * Session 子树归档流程。
 *
 * Worker持久化固定后序UUID计划，集合预留全部待提交地址并检查缓存节点空闲。
 * 按计划归档；部分失败用原operation_id恢复，不重新扫描或选取重建后的活动记录。
 * 宿主通知不在这里等待，避免回调延长关系保护或在重入时产生死锁。
 */
import { randomUUID as random_uuid } from "node:crypto";
import { SessionArchiveOperationError } from "./SessionArchiveOperationError.js";
import type { AgentArchivePlan } from "@/types/store/AgentArchivePlan.js";
import { normalize_session_id } from "@/session/SessionIdentity.js";
import { normalize_session_origin_category, SESSION_ORIGIN_CATEGORY_WORK } from "@downcity/type";
import type { AgentArchiveSessionInput, AgentArchiveSessionResult } from "@/types/agent/SessionTypes.js";
import type { SessionArchiveOptions } from "@/types/agent/SessionArchive.js";
import type { AgentManagedSession } from "@/types/session/SessionOptions.js";

/** 在集合扫描保护内生成计划，预留后只操作待归档子树。 */
export async function archive_session_subtree(input: AgentArchiveSessionInput, options: SessionArchiveOptions): Promise<AgentArchiveSessionResult> {
  const session_id = normalize_session_id(input?.id || "");
  if (!session_id) throw new Error("sessions.archive requires a non-empty id");
  const category = normalize_session_origin_category(input.category ?? SESSION_ORIGIN_CATEGORY_WORK);
  if (input.root_session_id !== undefined && input.root_session_id !== session_id) throw new Error("session_archive_operation_conflict");
  const operation_id = input.operation_id ?? random_uuid();
  const locked = new Map<string, AgentManagedSession>();
  let plan: AgentArchivePlan | undefined;
  try {
    plan = await options.store.prepare_archive({ operation_id, session_id, category });
    const pending = plan.nodes.filter(node => node.committed_at === null);
    options.reserve_sessions(pending.map(node => ({ id: node.session_id, category: node.category })));
    // 数据已提交但宿主缓存清理前中断时，重入也只清理匹配原UUID的句柄。
    for (const node of plan.nodes.filter(node => node.committed_at !== null)) {
      const cached = options.get_cached(node.session_id, node.category);
      if (!cached || (await cached.get_info()).session_id !== node.session_id) continue;
      cached.begin_archive();
      await options.store.commit_archive_node({ operation_id, root_session_id: plan.root_session_id, fingerprint: plan.fingerprint, position: node.position });
      cached.finish_archive(true); cached.dispose_title_generation?.(); cached.clear_secrets();
      options.remove_cached(node.session_id, node.category);
      options.record_removal({ type: "archived", session_id: node.session_id, category: node.category,
        origin_type: node.origin_type, ...(node.workspace_id ? { workspace_id: node.workspace_id } : {}) });
    }
    // 先预留全部逻辑地址，再核对缓存真实UUID并关闭输入；不取得重建记录的句柄。
    for (const node of pending) {
      const cached = options.get_cached(node.session_id, node.category);
      if (!cached) continue;
      const info = await cached.get_info();
      if (info.session_id !== node.session_id) throw new Error("session_archive_record_changed");
      cached.begin_archive(); locked.set(node.session_id, cached);
    }
    for (const node of pending) {
      plan = await options.store.commit_archive_node({ operation_id, root_session_id: plan.root_session_id,
        fingerprint: plan.fingerprint, position: node.position });
      const cached = locked.get(node.session_id);
      cached?.finish_archive(true); locked.delete(node.session_id);
      cached?.dispose_title_generation?.(); cached?.clear_secrets();
      if (cached) options.remove_cached(node.session_id, node.category);
      options.record_removal({ type: "archived", session_id: node.session_id, category: node.category,
        origin_type: node.origin_type, ...(node.workspace_id ? { workspace_id: node.workspace_id } : {}) });
    }
    return { session_id, operation_id, root_session_id: plan.root_session_id, plan_fingerprint: plan.fingerprint,
      archived_at: plan.nodes.at(-1)!.committed_at!, changed: pending.length > 0 };
  } catch (error) {
    throw new SessionArchiveOperationError(operation_id, error, plan, input.root_session_id);
  } finally {
    for (const cached of locked.values()) cached.finish_archive(false);
  }
}
