/**
 * GroupSession 导航投影更新。
 *
 * canonical title 来自 SDK GroupSession；本模块只把同一标题同步到 Renderer 的
 * Group 列表与 Workspace 索引，不自行从消息摘要推导标题。
 */

import type { DesktopGroupSummary } from "@common/types/DesktopApi";
import type { DesktopWorkspaceGroupSession } from "@/types/DesktopView";

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

/** 更新按 Workspace 建立的 GroupSession 导航投影。 */
export function update_group_session_title_index(
  current: Record<string, DesktopWorkspaceGroupSession[]>,
  group_id: string,
  session_id: string,
  title: string,
): Record<string, DesktopWorkspaceGroupSession[]> {
  return Object.fromEntries(Object.entries(current).map(([workspace_id, entries]) => [
    workspace_id,
    entries.map((entry) => entry.group_id === group_id
      ? {
          ...entry,
          ...(entry.session.session_id === session_id
            ? { session: { ...entry.session, title } }
            : {}),
          group: update_group_session_title(entry.group, group_id, session_id, title),
        }
      : entry),
  ]));
}
