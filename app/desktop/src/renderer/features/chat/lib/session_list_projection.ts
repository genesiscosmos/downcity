/**
 * Desktop Session 导航目录的分组与列表投影。
 *
 * ## 会话的入口只有一处
 *
 * 会话住在某个 Workspace 里，因此「这个 Workspace 里有哪些会话」是唯一的会话视图；
 * Agents 侧栏只回答「有哪些 Agent」，不再各自列一份会话。两类会话在这里被统一成同一种行：
 *
 * ```text
 * Agent Session  →  sessions_by_workspace（启动时按 Agent 全量拉取）
 * GroupSession   →  group.sessions（随 Group 目录加载，自带 workspace_id）
 * ```
 *
 * 两者除了取数与点击去向，在列表里没有区别：都按「实时优先、其次最近更新」排，
 * 都由父行汇总状态，都显示归属名称。因此排序规则只有一份（`compare_session_rows`），
 * 同一个会话不会在两个视图里落在不同位置。
 */

import type { DesktopGroupSessionSummary, DesktopGroupSummary, DesktopSessionSummary } from "@common/types/DesktopApi";
import type { ChatLiveStatus, DesktopWorkspaceSession, NavigationTarget } from "@/types/DesktopView";

/** Agent 主体入口可以恢复的最近对话目标。 */
export type AgentChatTarget = Extract<NavigationTarget, { kind: "session" } | { kind: "draft" }>;

/** 一条属于某 Workspace 的 Agent Session。 */
export interface AgentWorkspaceSessionEntry {
  /** 会话类型；决定行的归属文字与点击去向。 */
  kind: "agent";
  /** 行内稳定 key；两类会话可能同名，必须带类型前缀。 */
  key: string;
  /** 这条会话所属的 Workspace。 */
  workspace_id: string;
  /** 执行这条会话的 Agent 标识。 */
  agent_id: string;
  /** 会话摘要。 */
  session: DesktopSessionSummary;
  /** 实时运行态；由调用方解析，排序与行状态共用同一份结果。 */
  live_status: ChatLiveStatus | null;
}

/** 一条属于某 Workspace 的 GroupSession。 */
export interface GroupWorkspaceSessionEntry {
  /** 会话类型；决定行的归属文字与点击去向。 */
  kind: "group";
  /** 行内稳定 key；两类会话可能同名，必须带类型前缀。 */
  key: string;
  /** 这条会话所属的 Workspace。 */
  workspace_id: string;
  /** 这条会话所属的 Group 标识。 */
  group_id: string;
  /** GroupSession 摘要。 */
  session: DesktopGroupSessionSummary;
  /** 实时运行态；由调用方解析，排序与行状态共用同一份结果。 */
  live_status: ChatLiveStatus | null;
}

/** Workspace 会话树里的一条叶子。 */
export type WorkspaceSessionEntry = AgentWorkspaceSessionEntry | GroupWorkspaceSessionEntry;

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
 * 会话列表共用的排序：**实时优先，其次最近更新**。
 *
 * 只比较与排序有关的两个字段（`live_status` 与 `updated_at`），因此 Agent Session 与
 * GroupSession 都能直接进来——两者的摘要结构不同，但这两个字段同名同义。
 * 抽出来而不是各写一遍：排序规则一分叉，同一个会话在两个视图里就会落在不同位置。
 */
function compare_session_rows(
  left: { live_status: ChatLiveStatus | null; updated_at: number },
  right: { live_status: ChatLiveStatus | null; updated_at: number },
): number {
  return Number(right.live_status !== null) - Number(left.live_status !== null)
    || right.updated_at - left.updated_at;
}

/**
 * 从完整目录投影**一个 Workspace 的**会话列表，同时包含 Agent Session 与 GroupSession。
 *
 * 每个条目都必须带归属标识（`agent_id` / `group_id`）：同一个 Workspace 里会有多个 Agent
 * 与多个 Group 的会话，少了它就分不清两条同名会话各是谁的。
 *
 * 未水合时 Agent Session 部分是空数组——“还没读到”与“确实没有”由调用方按 `hydrated` 区分，
 * 不在这里猜。Group 会话不受 `hydrated` 影响：它随 Group 目录一起到达，因此 Group 目录可用时
 * 它就是确定的。
 *
 * 两类会话的实时运行态来源不同（Agent 看 Session Runtime，Group 看群阶段与待响应交互），
 * 因此各交一个解析回调，而不是在这里认识两种运行态结构。
 */
export function select_workspace_session_entries(options: {
  /** 按 Workspace 索引的 Agent Session 目录。 */
  sessions_by_workspace: Record<string, DesktopWorkspaceSession[]>;
  /** 全部 Group 及其会话摘要。 */
  groups: readonly DesktopGroupSummary[];
  /** 要投影的 Workspace 标识。 */
  workspace_id: string;
  /** 解析一条 Agent Session 的实时运行态。 */
  resolve_agent_live_status(workspace_id: string, agent_id: string, session: DesktopSessionSummary): ChatLiveStatus | null;
  /** 解析一条 GroupSession 的实时运行态。 */
  resolve_group_live_status(group_id: string, session: DesktopGroupSessionSummary): ChatLiveStatus | null;
}): WorkspaceSessionEntry[] {
  const { sessions_by_workspace, groups, workspace_id, resolve_agent_live_status, resolve_group_live_status } = options;
  if (!workspace_id) return [];
  const agent_entries: AgentWorkspaceSessionEntry[] = (sessions_by_workspace[workspace_id] ?? []).map((entry) => ({
    kind: "agent",
    key: `agent:${entry.agent_id}:${entry.session.session_id}`,
    workspace_id,
    agent_id: entry.agent_id,
    session: entry.session,
    live_status: resolve_agent_live_status(workspace_id, entry.agent_id, entry.session),
  }));
  const group_entries: GroupWorkspaceSessionEntry[] = groups.flatMap((group) => group.sessions
    .filter((session) => session.workspace_id === workspace_id)
    .map((session) => ({
      kind: "group" as const,
      key: `group:${group.group_id}:${session.session_id}`,
      workspace_id,
      group_id: group.group_id,
      session,
      live_status: resolve_group_live_status(group.group_id, session),
    })));
  // 两类会话共用一条时间轴：实时在前、其次最近更新（见 compare_session_rows）。
  return [...agent_entries, ...group_entries]
    .map((entry) => ({ entry, updated_at: entry.session.updated_at }))
    .sort((left, right) => compare_session_rows(
      { live_status: left.entry.live_status, updated_at: left.updated_at },
      { live_status: right.entry.live_status, updated_at: right.updated_at },
    ))
    .map((item) => item.entry);
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
