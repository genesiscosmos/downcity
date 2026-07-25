/**
 * Control Session 摘要投影。
 *
 * 关键点（中文）
 * - 只消费 @downcity/agent 的 Session 列表 API，不读取物理存储路径。
 * - 控制面字段变化集中在这里，避免 HTTP 路由复制映射逻辑。
 */

import type { AgentSession, AgentSessions } from "@downcity/agent";
import type { ControlSessionSummary } from "@/city/agent/control/types/ControlViewData.js";

/** 读取并投影控制面所需的 Session 摘要。 */
export async function list_control_session_summaries(
  sessions: AgentSessions<AgentSession>,
  limit: number,
): Promise<ControlSessionSummary[]> {
  return (await sessions.list({ limit })).items.map((session) => ({
    session_id: session.session_id,
    message_count: session.message_count,
    ...(typeof session.updated_at === "number"
      ? { updated_at: session.updated_at }
      : {}),
    ...(session.preview_text ? { lastText: session.preview_text } : {}),
    ...(session.executing ? { executing: true } : {}),
  }));
}
