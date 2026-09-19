/** Desktop Session 导航目录的分组与列表投影。 */

import type { DesktopSessionSummary } from "@common/types/DesktopApi";
import type { ChatLiveStatus, DesktopWorkspaceSession, NavigationTarget } from "@/types/DesktopView";

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

/**
 * 两个会话列表共用的排序：**实时优先，其次最近更新**。
 *
 * 抽出来而不是各写一遍：Agent 列表与 Workspace 列表回答的是同一类问题
 *（「现在最该看哪一条」），排序规则一分叉，同一个会话在两个侧栏里就会落在不同位置。
 */
function compare_session_rows(
  left: { live_status: ChatLiveStatus | null; session: DesktopSessionSummary },
  right: { live_status: ChatLiveStatus | null; session: DesktopSessionSummary },
): number {
  return Number(right.live_status !== null) - Number(left.live_status !== null)
    || right.session.updated_at - left.session.updated_at;
}

/** 从完整 Session 目录投影一个 Agent 跨 Workspace 的导航列表。 */
export function select_agent_sessions(
  sessions_by_workspace: Record<string, DesktopWorkspaceSession[]>,
  agent_id: string,
  resolve_live_status: (workspace_id: string, session: DesktopSessionSummary) => ChatLiveStatus | null = (_workspace_id, session) => session.executing ? "working" : null,
): Array<{ workspace_id: string; session: DesktopSessionSummary; live_status: ChatLiveStatus | null }> {
  if (!agent_id) return [];
  return Object.entries(sessions_by_workspace)
    .flatMap(([workspace_id, entries]) => entries
      .filter((entry) => entry.agent_id === agent_id)
      .map((entry) => ({
        workspace_id,
        session: entry.session,
        live_status: resolve_live_status(workspace_id, entry.session),
      })))
    .sort(compare_session_rows);
}

/**
 * 从完整 Session 目录投影**一个 Workspace 的**会话列表（跨 Agent）。
 *
 * 与 `select_agent_sessions` 是同一件事的另一个切面：那个按 Agent 切、跨 Workspace，
 * 这个按 Workspace 切、跨 Agent。两者共用排序，所以同一个会话无论从哪个侧栏看，
 * 位置都一致。
 *
 * 返回项**必须带 `agent_id`**：Workspace 视角下同一个 Workspace 里会有多个 Agent 的会话，
 * 少了它就分不清两条同名会话各是谁的（Chat 侧栏不需要，因为主体行已经说明了 Agent）。
 *
 * 未水合时调用方拿到的是空数组——「还没读到」与「确实没有」由调用方按 `hydrated` 区分，
 * 不在这里猜。
 */
export function select_workspace_sessions(
  sessions_by_workspace: Record<string, DesktopWorkspaceSession[]>,
  workspace_id: string,
  resolve_live_status: (workspace_id: string, agent_id: string, session: DesktopSessionSummary) => ChatLiveStatus | null = (_workspace_id, _agent_id, session) => session.executing ? "working" : null,
): Array<{ agent_id: string; session: DesktopSessionSummary; live_status: ChatLiveStatus | null }> {
  if (!workspace_id) return [];
  return (sessions_by_workspace[workspace_id] ?? [])
    .map((entry) => ({
      agent_id: entry.agent_id,
      session: entry.session,
      live_status: resolve_live_status(workspace_id, entry.agent_id, entry.session),
    }))
    .sort(compare_session_rows);
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
