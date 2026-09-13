/** Group 运行态在 Renderer store 中的轻量比较与投影规则。 */

import type { DesktopGroupMemberRuntime, DesktopGroupStatusPhase } from "@common/types/DesktopApi";
import type { ChatLiveStatus } from "@/types/DesktopView";

/** 比较两份有序成员运行态，避免相同 IPC status 重复发布 Renderer 快照。 */
export function same_group_member_statuses(left: DesktopGroupMemberRuntime[] | undefined, right: DesktopGroupMemberRuntime[]): boolean {
  return left === right || Boolean(left && left.length === right.length && left.every((status, index) => status.agent_id === right[index]?.agent_id && status.running === right[index]?.running));
}

/** Group 是否正占用运行槽；idle / stopped / failed 都表示已经停下来。 */
export function is_group_phase_running(phase?: DesktopGroupStatusPhase): boolean {
  return phase === "dispatching" || phase === "dispatched" || phase === "executing";
}

/**
 * 解析 Group 一行的实时状态；没有正在发生的事时返回 null。
 *
 * 待响应交互优先于运行阶段：成员在等用户回答时 Group 仍然是 executing，但那已经不是「正在推进」，
 * 而是「该你说话了」。两条输入共用一个取值域，与 Agent 行的实时状态保持同一套语义。
 */
export function resolve_group_chat_live_status({ has_pending_interaction, running }: {
  /** 是否存在待响应的成员交互。 */
  has_pending_interaction: boolean;
  /** 是否处于推进中的运行阶段。 */
  running: boolean;
}): ChatLiveStatus | null {
  if (has_pending_interaction) return "action_required";
  return running ? "working" : null;
}
