/** Group 运行态在 Renderer store 中的轻量比较与投影规则。 */

import type { DesktopGroupMemberRuntime } from "@common/types/DesktopApi";

/** 比较两份有序成员运行态，避免相同 IPC status 重复发布 Renderer 快照。 */
export function same_group_member_statuses(left: DesktopGroupMemberRuntime[] | undefined, right: DesktopGroupMemberRuntime[]): boolean {
  return left === right || Boolean(left && left.length === right.length && left.every((status, index) => status.agent_id === right[index]?.agent_id && status.running === right[index]?.running));
}
