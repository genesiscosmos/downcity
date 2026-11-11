/**
 * Session 子树归档流程。
 *
 * 扫描不可变直接父子关系，预留完整计划，再同步检查所有缓存节点是否空闲。
 * 预检通过后按子节点优先搬迁；部分失败保留未搬迁节点，下一次调用继续收敛。
 * 宿主通知不在这里等待，避免回调延长关系保护或在重入时产生死锁。
 */
import { normalize_session_id } from "@/session/SessionIdentity.js";
import { normalize_session_origin_category, SESSION_ORIGIN_CATEGORY_WORK, SESSION_ORIGIN_TYPE_WORK } from "@downcity/type";
import type { AgentArchiveSessionInput, AgentArchiveSessionResult, AgentSessionSummary } from "@/types/agent/SessionTypes.js";
import type { SessionArchiveOptions } from "@/types/agent/SessionArchive.js";
import type { AgentManagedSession } from "@/types/session/SessionOptions.js";

/** 在集合扫描保护内生成计划，预留后只操作待归档子树。 */
export async function archive_session_subtree(input: AgentArchiveSessionInput, options: SessionArchiveOptions): Promise<AgentArchiveSessionResult> {
  const session_id = normalize_session_id(input?.id || "");
  if (!session_id) throw new Error("sessions.archive requires a non-empty id");
  const category = normalize_session_origin_category(input.category ?? SESSION_ORIGIN_CATEGORY_WORK);
  const root_view = await options.store.read_session(session_id, category);
  const complete_plan = await collect_archive_plan(session_id, category, options);
  // 已归档根仍扫描活动后代，保证部分失败后的重试能收敛。
  const plan = root_view.archived ? complete_plan.filter((item) => item.id !== session_id || item.category !== category) : complete_plan;
  options.reserve_sessions(complete_plan);
  const locked = new Set<AgentManagedSession>();
  try {
    // 此循环没有 await：全部节点预检成功前不移动任何数据。
    for (const item of plan) {
      const cached = options.get_cached(item.id, item.category!);
      if (!cached) continue;
      cached.begin_archive();
      locked.add(cached);
    }
    let root_result: AgentArchiveSessionResult | undefined;
    for (const item of plan) {
      const item_category = item.category!;
      const cached = options.get_cached(item.id, item_category);
      const result = await options.store.archive_session(item.id, item_category);
      cached?.finish_archive(true);
      if (cached) locked.delete(cached);
      cached?.dispose_title_generation?.();
      cached?.clear_secrets();
      options.remove_cached(item.id, item_category);
      options.record_removal({
        type: "archived", session_id: item.id, category: item_category,
        origin_type: cached?.origin.type ?? SESSION_ORIGIN_TYPE_WORK,
        workspace_id: cached?.workspace_id,
      });
      root_result = result;
    }
    return { ...(root_view.archived ? { session_id } : root_result!), changed: plan.length > 0 };
  } finally {
    for (const cached of locked) cached.finish_archive(false);
  }
}

/** 完整分页读取 Work 目录，按同一 Agent 的直接父子关系生成后序计划。 */
async function collect_archive_plan(session_id: string, category: string, options: SessionArchiveOptions): Promise<AgentArchiveSessionInput[]> {
  const children = new Map<string, AgentSessionSummary[]>();
  let cursor: string | undefined;
  const seen_cursors = new Set<string>();
  do {
    const page = await options.store.list_sessions({ category: SESSION_ORIGIN_CATEGORY_WORK, limit: 200, ...(cursor ? { cursor } : {}) }, new Set());
    for (const session of page.items) {
      const origin = session.origin;
      if (origin.parent_agent_id !== options.agent_id || typeof origin.parent_session_id !== "string"
        || typeof origin.parent_session_category !== "string") continue;
      const parent_key = `${origin.parent_session_category}\u0000${origin.parent_session_id}`;
      const siblings = children.get(parent_key) ?? [];
      siblings.push(session);
      children.set(parent_key, siblings);
    }
    if (!page.has_more) break;
    if (!page.next_cursor || seen_cursors.has(page.next_cursor)) throw new Error("Session archive received an invalid pagination cursor");
    cursor = page.next_cursor;
    seen_cursors.add(cursor);
  } while (true);
  const plan: AgentArchiveSessionInput[] = [];
  const visited = new Set<string>();
  const append = (id: string, item_category: string) => {
    const key = `${item_category}\u0000${id}`;
    if (visited.has(key)) throw new Error(`Session archive found a cyclic parent relation: ${id}`);
    visited.add(key);
    for (const child of children.get(key) ?? []) append(child.session_id, child.origin.category);
    plan.push({ id, category: item_category });
  };
  append(session_id, category);
  return plan;
}
