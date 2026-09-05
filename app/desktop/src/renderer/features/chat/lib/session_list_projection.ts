/** Desktop Session 导航目录的分组与列表投影。 */

import type { DesktopSessionSummary } from "@common/types/DesktopApi";
import type { DesktopWorkspaceSession } from "@/types/DesktopView";

/** 将各 Agent 的 canonical Session 摘要按 Session 自身 Workspace 归属分组。 */
export function group_agent_sessions_by_workspace(
  sessions_by_agent: Array<{ agent_id: string; sessions: DesktopSessionSummary[] }>,
): Record<string, DesktopWorkspaceSession[]> {
  const grouped_sessions: Record<string, DesktopWorkspaceSession[]> = {};
  for (const { agent_id, sessions } of sessions_by_agent) {
    for (const session of sessions) {
      const workspace_id = session.workspace_id || "";
      (grouped_sessions[workspace_id] ??= []).push({ agent_id, session });
    }
  }
  return grouped_sessions;
}

/** 从完整 Session 目录投影一个 Agent 跨 Workspace 的导航列表。 */
export function select_agent_sessions(
  sessions_by_workspace: Record<string, DesktopWorkspaceSession[]>,
  agent_id: string,
): Array<{ workspace_id: string; session: DesktopSessionSummary }> {
  if (!agent_id) return [];
  return Object.entries(sessions_by_workspace)
    .flatMap(([workspace_id, entries]) => entries
      .filter((entry) => entry.agent_id === agent_id)
      .map((entry) => ({ workspace_id, session: entry.session })))
    .sort((left, right) => Number(right.session.executing) - Number(left.session.executing)
      || right.session.updated_at - left.session.updated_at);
}
