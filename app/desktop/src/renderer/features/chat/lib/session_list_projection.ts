/** Desktop Session 导航目录的分组与列表投影。 */

import type { DesktopSessionSummary } from "@common/types/DesktopApi";
import type { DesktopWorkspaceSession, NavigationTarget } from "@/types/DesktopView";

/** Agent 主体入口可以恢复的最近对话目标。 */
export type AgentChatTarget = Extract<NavigationTarget, { kind: "session" } | { kind: "draft" }>;

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
  resolve_executing: (workspace_id: string, session: DesktopSessionSummary) => boolean = (_workspace_id, session) => session.executing,
): Array<{ workspace_id: string; session: DesktopSessionSummary; executing: boolean }> {
  if (!agent_id) return [];
  return Object.entries(sessions_by_workspace)
    .flatMap(([workspace_id, entries]) => entries
      .filter((entry) => entry.agent_id === agent_id)
      .map((entry) => ({
        workspace_id,
        session: entry.session,
        executing: resolve_executing(workspace_id, entry.session),
      })))
    .sort((left, right) => Number(right.executing) - Number(left.executing)
      || right.session.updated_at - left.session.updated_at);
}

/**
 * 解析点击 Agent 主体时应恢复的对话。
 *
 * “最近打开”是导航行为，不等于 Session 的 `updated_at`。优先恢复本次应用生命周期中
 * 最后访问的 Session 或 Draft；目标失效后才回退到最近更新的 Session。
 */
export function resolve_agent_chat_target(
  sessions_by_workspace: Record<string, DesktopWorkspaceSession[]>,
  workspace_ids: ReadonlySet<string>,
  agent_id: string,
  recent_target?: AgentChatTarget,
): AgentChatTarget | undefined {
  if (recent_target?.agent_id === agent_id && workspace_ids.has(recent_target.workspace_id)) {
    if (recent_target.kind === "draft") return recent_target;
    const target_exists = sessions_by_workspace[recent_target.workspace_id]?.some((entry) => (
      entry.agent_id === agent_id && entry.session.session_id === recent_target.session_id
    ));
    if (target_exists) return recent_target;
  }

  const latest = Object.entries(sessions_by_workspace)
    .flatMap(([workspace_id, entries]) => entries
      .filter((entry) => entry.agent_id === agent_id && workspace_ids.has(workspace_id))
      .map((entry) => ({ workspace_id, session: entry.session })))
    .sort((left, right) => right.session.updated_at - left.session.updated_at)[0];
  return latest ? { kind: "session", workspace_id: latest.workspace_id, agent_id, session_id: latest.session.session_id } : undefined;
}
