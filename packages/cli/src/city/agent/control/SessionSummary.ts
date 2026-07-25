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
    sessionId: session.sessionId,
    messageCount: session.messageCount,
    ...(typeof session.updatedAt === "number"
      ? { updatedAt: session.updatedAt }
      : {}),
    ...(session.previewText ? { lastText: session.previewText } : {}),
    ...(session.executing ? { executing: true } : {}),
  }));
}
