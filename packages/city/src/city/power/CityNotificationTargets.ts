/**
 * 通知目标的 City 目录适配。枚举原主体活动与归档集合，不解释已读或通知策略。
 * 两个 Session 分区都完整分页；任何读取失败单独报告未知，避免把暂时不可达当成删除。
 */
import type { Agent, Group } from "@downcity/agent";
import type { PowerNotificationTargets } from "@/power/types/PowerNotification.js";

/** 在明确更新入口取得完整活动与归档目录；单个主体断连单独报告未知。 */
export async function list_notification_targets(agents: readonly Agent[], groups: readonly Group[], workspace_ids: string[]): Promise<PowerNotificationTargets> {
  const result: PowerNotificationTargets = { targets: [], archived_targets: [], agent_ids: agents.map((agent) => agent.id), group_ids: groups.map((group) => group.id), target_workspaces: {}, workspace_ids, unavailable_agents: [], unavailable_groups: [] };
  await Promise.all(agents.map(async (agent) => {
    try {
      const targets: PowerNotificationTargets["targets"] = [];
      const archived_targets: PowerNotificationTargets["targets"] = [];
      const target_workspaces: Record<string, string> = {};
      for (const category of ["chat", "work"]) {
        for (const archived of [false, true]) {
          let cursor: string | undefined;
          const cursors = new Set<string>();
          do {
            const page = archived ? await agent.sessions.archived({ category, cursor, limit: 200 })
              : await agent.sessions.list({ category, cursor, limit: 200 });
            for (const item of page.items) {
              const target = { kind: "agent_session" as const, agent_id: agent.id,
                session_id: item.session_id, category: item.origin.category, origin_type: item.origin.type };
              (archived ? archived_targets : targets).push(target);
              if (!archived && item.workspace_id) target_workspaces[JSON.stringify([target.kind, agent.id, item.origin.category, item.session_id])] = item.workspace_id;
            }
            cursor = page.next_cursor ?? undefined;
            if (cursor && cursors.has(cursor)) throw new Error("Invalid Session directory cursor");
            if (cursor) cursors.add(cursor);
          } while (cursor);
        }
      }
      result.targets.push(...targets);
      result.archived_targets.push(...archived_targets);
      Object.assign(result.target_workspaces, target_workspaces);
    } catch { result.unavailable_agents.push(agent.id); }
  }));
  await Promise.all(groups.map(async (group) => {
    try {
      const active = await group.sessions.list();
      const archived = await group.sessions.archived();
      for (const item of active) {
        result.targets.push({ kind: "group_session", group_id: group.id, session_id: item.id });
        if (item.workspace_id) result.target_workspaces[JSON.stringify(["group_session", group.id, item.id])] = item.workspace_id;
      }
      for (const item of archived) result.archived_targets.push({ kind: "group_session", group_id: group.id, session_id: item.id });
    } catch { result.unavailable_groups.push(group.id); }
  }));
  return result;
}
