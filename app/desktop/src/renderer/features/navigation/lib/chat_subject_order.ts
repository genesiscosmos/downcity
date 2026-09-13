/**
 * Chat Sidebar 主体列表的「最近活跃」排序投影。
 *
 * Agent 与 Group 共用同一条时间轴：最近一次对话越新越靠前。
 * 排序输入全部取自 Renderer 已经持有的目录（Session 导航索引、Chat 运行态、Group 摘要），
 * 因此不新增持久化字段，也不在主进程重复扫描 Session。
 */

import type {
  DesktopAgentSummary,
  DesktopChatRuntime,
  DesktopGroupSummary,
} from "@common/types/DesktopApi";
import type { DesktopWorkspaceSession } from "@/types/DesktopView";

/** 从未产生过对话的时间占位；真实 Session 的更新时间始终大于 0。 */
const never_active_at = 0;

/** 主体行共有的排序信息。 */
interface ChatSubjectBase {
  /** 行内稳定 key；Agent 与 Group 可能重名，必须带类型前缀。 */
  key: string;
  /** 最近一次对话时间，单位为毫秒；从未对话时为 0。 */
  last_active_at: number;
}

/** 一个 Agent 主体行。 */
export interface AgentChatSubject extends ChatSubjectBase {
  /** 主体类型。 */
  kind: "agent";
  /** Agent 摘要。 */
  agent: DesktopAgentSummary;
}

/** 一个 Group 主体行。 */
export interface GroupChatSubject extends ChatSubjectBase {
  /** 主体类型。 */
  kind: "group";
  /** Group 摘要。 */
  group: DesktopGroupSummary;
}

/** Chat Sidebar 主体列表中的一行。 */
export type ChatSubject = AgentChatSubject | GroupChatSubject;

/**
 * 汇总每个 Agent 跨 Workspace 的最近一次对话时间。
 *
 * 只读取传入的 Session 导航索引。调用方不传归档索引，因此「归档一个 Session」不会被算成
 * 一次新的对话，也不会把一个已经收起的 Agent 顶到最前。
 */
export function collect_agent_last_active(
  sessions_by_workspace: Record<string, DesktopWorkspaceSession[]>,
): Record<string, number> {
  const last_active_by_agent: Record<string, number> = {};
  for (const entries of Object.values(sessions_by_workspace)) {
    for (const entry of entries) {
      const updated_at = entry.session.updated_at || never_active_at;
      if (updated_at > (last_active_by_agent[entry.agent_id] ?? never_active_at)) {
        last_active_by_agent[entry.agent_id] = updated_at;
      }
    }
  }
  return last_active_by_agent;
}

/** 汇总每个 Group 的最近一次群聊时间。 */
export function collect_group_last_active(
  groups: readonly DesktopGroupSummary[],
): Record<string, number> {
  const last_active_by_group: Record<string, number> = {};
  for (const group of groups) {
    for (const session of group.sessions) {
      const updated_at = session.updated_at || never_active_at;
      if (updated_at > (last_active_by_group[group.group_id] ?? never_active_at)) {
        last_active_by_group[group.group_id] = updated_at;
      }
    }
  }
  return last_active_by_group;
}

/**
 * 用实时 Chat 运行态补上目录之后发生的对话。
 *
 * Session 导航索引只在启动时整体加载，消息写入不会回写它，因此刚聊完的 Agent 需要运行态补位。
 * 只有真正跑过 Turn 的运行态才计入：打开一个 Session 时 Main 会补一份 idle 运行态，
 * 它只说明「看过了」，不说明「聊过了」。
 */
export function merge_runtime_activity(
  last_active_by_agent: Record<string, number>,
  chat_runtimes: Record<string, DesktopChatRuntime>,
): Record<string, number> {
  const merged: Record<string, number> = { ...last_active_by_agent };
  for (const runtime of Object.values(chat_runtimes)) {
    if (!counts_as_conversation(runtime)) continue;
    if (runtime.updated_at > (merged[runtime.agent_id] ?? never_active_at)) {
      merged[runtime.agent_id] = runtime.updated_at;
    }
  }
  return merged;
}

/** 判断一个运行态是否代表真实发生过的对话。 */
function counts_as_conversation(runtime: DesktopChatRuntime): boolean {
  return Boolean(runtime.turn_id)
    || runtime.status === "submitted"
    || runtime.status === "streaming"
    || runtime.status === "waiting_input";
}

/**
 * 按最近一次对话时间倒序合并 Agent 与 Group。
 *
 * 末级比较必须存在：同一时间点上不同主体的输入顺序会随目录加载时机变化，缺少末级规则会让
 * 列表在刷新后无理由换位。时间相同时先 Agent 后 Group，再按名称升序。
 */
export function order_chat_subjects(input: {
  /** 全部 Agent 摘要。 */
  agents: readonly DesktopAgentSummary[];
  /** 全部 Group 摘要。 */
  groups: readonly DesktopGroupSummary[];
  /** 每个 Agent 的最近一次对话时间。 */
  last_active_by_agent: Record<string, number>;
  /** 每个 Group 的最近一次群聊时间。 */
  last_active_by_group: Record<string, number>;
}): ChatSubject[] {
  const subjects: ChatSubject[] = [
    ...input.agents.map((agent): AgentChatSubject => ({
      kind: "agent",
      key: `agent:${agent.agent_id}`,
      last_active_at: input.last_active_by_agent[agent.agent_id] ?? never_active_at,
      agent,
    })),
    ...input.groups.map((group): GroupChatSubject => ({
      kind: "group",
      key: `group:${group.group_id}`,
      last_active_at: input.last_active_by_group[group.group_id] ?? never_active_at,
      group,
    })),
  ];
  return subjects.sort((left, right) => right.last_active_at - left.last_active_at
    || subject_kind_order(left) - subject_kind_order(right)
    || subject_label(left).localeCompare(subject_label(right)));
}

/** Agent 在时间相同时排在同名 Group 之前。 */
function subject_kind_order(subject: ChatSubject): number {
  return subject.kind === "agent" ? 0 : 1;
}

/** 末级排序使用的用户可见名称。 */
function subject_label(subject: ChatSubject): string {
  return subject.kind === "agent" ? subject.agent.name : subject.group.name;
}
