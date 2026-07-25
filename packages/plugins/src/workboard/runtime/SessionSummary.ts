/**
 * Workboard session 摘要采集。
 *
 * 关键点（中文）
 * - workboard 只需要模糊运行态，不复用 downcity control 视图模型。
 * - 这里只读取消息数量、更新时间与执行中状态，不暴露消息内容。
 */

import type { PluginContext } from "@downcity/agent";

/**
 * Workboard 内部 session 摘要。
 */
export interface WorkboardSessionSummary {
  /**
   * session 稳定标识，仅供内部排序和执行态匹配使用，不会进入公开输出。
   */
  session_id: string;
  /**
   * 当前 session 消息数量。
   */
  message_count: number;
  /**
   * 最近更新时间戳。
   */
  updated_at?: number;
  /**
   * 当前 session 是否仍在执行。
   */
  executing?: boolean;
}

/**
 * 采集 workboard 需要的 session 摘要。
 */
export async function listWorkboardSessionSummaries(params: {
  /**
   * Agent runtime context。
   */
  context: PluginContext;
  /**
   * 返回上限。
   */
  limit: number;
  /**
   * 正在执行的 session id 集合。
   */
  executingSessionIds?: Set<string>;
}): Promise<WorkboardSessionSummary[]> {
  const page = await params.context.sessions.list({
    limit: Math.max(1, params.limit),
  });
  return page.items.map((item) => ({
    session_id: item.session_id,
    message_count: item.message_count,
    ...(typeof item.updated_at === "number" ? { updated_at: item.updated_at } : {}),
    ...(item.executing || params.executingSessionIds?.has(item.session_id)
      ? { executing: true }
      : {}),
  }));
}
