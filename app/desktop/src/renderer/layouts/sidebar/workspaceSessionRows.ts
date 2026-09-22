/**
 * Works 会话树的投影：把 Session 目录、Group 目录与运行态投影成可直接渲染的行。
 *
 * ## 为什么投影单独成模块
 *
 * 它有两个消费者，而且必须看到**同一份结果**：
 *
 * - 列表用它渲染行；
 * - 多选的范围选择用它的顺序取连续段。
 *
 * 两处各算一遍，范围选择就会选中与用户看到的不一致的行（排序里含实时状态，两处很难碰巧一致）。
 * 因此投影是纯函数、只算一次，顺序就是渲染顺序。
 *
 * ## 两类会话在同一条时间轴上
 *
 * Agent Session 与 GroupSession 的摘要结构不同，但「最近更新」与「是否在跑」这两个字段
 * 同名同义，因此排序直接复用 `session_list_projection` 里那一份规则（实时优先、其次最近更新）。
 */

import type { DesktopAgentSummary, DesktopChatRuntime, DesktopGroupSummary, DesktopGroupStatusPhase } from "@common/types/DesktopApi";
import type { DesktopNotificationState } from "@common/types/DesktopNotification";
import type { DesktopWorkspaceSession } from "@/types/DesktopView";
import { get_session_key } from "@/features/chat/lib/chat_cache_key";
import { resolve_chat_row_status, type ChatRowStatus } from "@/features/chat/lib/chat_row_status";
import { resolve_chat_session_live_status } from "@/features/chat/lib/chat_runtime_projection";
import { is_group_phase_running, resolve_group_chat_live_status } from "@/features/chat/lib/group/group_runtime_projection";
import { select_workspace_session_entries, type WorkspaceSessionEntry } from "@/features/chat/lib/session_list_projection";
import { get_group_session_unread_attention, get_session_unread_attention } from "@/lib/notification/notification_state";

/**
 * 一条已解析的会话行。
 *
 * 归属对象、归属名称与状态都在这里算好：父行只读 `status`，子行三个都读，两边共用同一份结果。
 */
export interface WorkspaceSessionRow {
  /** 原始投影条目；决定点击去向、菜单种类与多选目标。 */
  entry: WorkspaceSessionEntry;
  /** Agent 会话的 Agent；对象已删除时为空。 */
  agent?: DesktopAgentSummary;
  /** Group 会话的 Group；对象已删除时为空。 */
  group?: DesktopGroupSummary;
  /** 归属名称（Agent 名或 Group 名）；对象已删除时为空。 */
  label?: string;
  /** 这一行的完整状态。 */
  status: ChatRowStatus;
}

/** 投影一个 Workspace 的会话行。 */
export function project_workspace_session_rows(options: {
  /** 目标 Workspace 标识。 */ workspace_id: string;
  /** 按 Workspace 索引的 Agent Session 目录。 */ sessions_by_workspace: Record<string, DesktopWorkspaceSession[]>;
  /** 全部 Group 及其会话。 */ groups: readonly DesktopGroupSummary[];
  /** 全部 Agent；用于解析归属。 */ agents: readonly DesktopAgentSummary[];
  /** 实时运行态，用于逐条状态。 */ chat_runtimes: Record<string, DesktopChatRuntime>;
  /** 各 Group 当前的运行阶段。 */ group_phase_by_group: Record<string, DesktopGroupStatusPhase>;
  /** 各 Group 待响应的成员交互数量。 */ group_interaction_counts: Record<string, number>;
  /** 当前通知快照。 */ notification_state: DesktopNotificationState;
}): WorkspaceSessionRow[] {
  const { workspace_id, sessions_by_workspace, groups, agents, chat_runtimes, group_phase_by_group, group_interaction_counts, notification_state } = options;
  const agents_by_id = new Map(agents.map((agent) => [agent.agent_id, agent]));
  const groups_by_id = new Map(groups.map((group) => [group.group_id, group]));
  const entries = select_workspace_session_entries({
    sessions_by_workspace,
    groups,
    workspace_id,
    resolve_agent_live_status: (session_workspace_id, agent_id, session) => (
      resolve_chat_session_live_status(chat_runtimes[get_session_key(session_workspace_id, agent_id, session.session_id)], session.executing)
    ),
    // Group 的实时状态只在当前打开的 GroupSession 上产生，因此侧栏能区分「等成员响应」与「正在推进」；
    // 未打开时的等待与失败仍由未读通知表达。
    resolve_group_live_status: (group_id) => resolve_group_chat_live_status({
      has_pending_interaction: (group_interaction_counts[group_id] ?? 0) > 0,
      running: is_group_phase_running(group_phase_by_group[group_id]),
    }),
  });
  return entries.map((entry) => ({
    entry,
    agent: entry.kind === "agent" ? agents_by_id.get(entry.agent_id) : undefined,
    group: entry.kind === "group" ? groups_by_id.get(entry.group_id) : undefined,
    label: entry.kind === "agent" ? agents_by_id.get(entry.agent_id)?.name : groups_by_id.get(entry.group_id)?.name,
    // 实时优先于未读：Runtime 描述此刻正在发生的事，未读只是过去的结果（见 chat_row_status）。
    status: resolve_chat_row_status(entry.live_status, entry.kind === "agent"
      ? get_session_unread_attention(notification_state, entry.workspace_id, entry.agent_id, entry.session.session_id)
      : get_group_session_unread_attention(notification_state, entry.group_id, entry.session.session_id)),
  }));
}

/** 投影全部 Workspace 的会话行，按 Workspace 索引。 */
export function project_all_workspace_session_rows(options: {
  /** 全部 Workspace 标识，按列表顺序。 */ workspace_ids: readonly string[];
  /** 按 Workspace 索引的 Agent Session 目录。 */ sessions_by_workspace: Record<string, DesktopWorkspaceSession[]>;
  /** 全部 Group 及其会话。 */ groups: readonly DesktopGroupSummary[];
  /** 全部 Agent；用于解析归属。 */ agents: readonly DesktopAgentSummary[];
  /** 实时运行态，用于逐条状态。 */ chat_runtimes: Record<string, DesktopChatRuntime>;
  /** 各 Group 当前的运行阶段。 */ group_phase_by_group: Record<string, DesktopGroupStatusPhase>;
  /** 各 Group 待响应的成员交互数量。 */ group_interaction_counts: Record<string, number>;
  /** 当前通知快照。 */ notification_state: DesktopNotificationState;
}): Map<string, WorkspaceSessionRow[]> {
  const map = new Map<string, WorkspaceSessionRow[]>();
  for (const workspace_id of options.workspace_ids) {
    map.set(workspace_id, project_workspace_session_rows({ ...options, workspace_id }));
  }
  return map;
}

/**
 * 每个 Workspace 新建对话时的默认联系人。
 *
 * 取该 Workspace 里**最近更新过**的那条 Agent 会话的 Agent：用户刚在这里聊过谁，
 * 开新对话时多半还是他。没有任何 Agent 会话时回退到 Agent 列表的第一个——
 * 它同时是「默认 Agent」设置生效后的结果（目录已按该设置排序过）。
 */
export function project_default_agent_ids(options: {
  /** 全部 Workspace 标识。 */ workspace_ids: readonly string[];
  /** 按 Workspace 索引的 Agent Session 目录。 */ sessions_by_workspace: Record<string, DesktopWorkspaceSession[]>;
  /** 全部 Agent。 */ agents: readonly DesktopAgentSummary[];
}): Map<string, string> {
  const { workspace_ids, sessions_by_workspace, agents } = options;
  const fallback_agent_id = agents[0]?.agent_id ?? "";
  const map = new Map<string, string>();
  for (const workspace_id of workspace_ids) {
    const latest = (sessions_by_workspace[workspace_id] ?? [])
      .slice()
      .sort((left, right) => right.session.updated_at - left.session.updated_at)[0];
    map.set(workspace_id, latest?.agent_id ?? fallback_agent_id);
  }
  return map;
}
