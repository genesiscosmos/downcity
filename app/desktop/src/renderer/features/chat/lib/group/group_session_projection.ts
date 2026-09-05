/**
 * GroupSession 导航投影更新。
 *
 * canonical title 来自 SDK GroupSession；本模块只更新 Catalog 中的 Group 摘要，
 * 不自行从消息摘要推导标题，也不维护重复的 Workspace 索引。
 */

import type { DesktopGroupSummary } from "@common/types/DesktopApi";

/** 更新一个 Group 中指定 GroupSession 的 canonical 标题。 */
export function update_group_session_title(
  group: DesktopGroupSummary,
  group_id: string,
  session_id: string,
  title: string,
): DesktopGroupSummary {
  if (group.group_id !== group_id) return group;
  return {
    ...group,
    sessions: group.sessions.map((session) => (
      session.session_id === session_id ? { ...session, title } : session
    )),
  };
}
