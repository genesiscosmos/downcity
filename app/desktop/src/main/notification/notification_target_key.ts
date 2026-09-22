/**
 * Notification 目标的可达键拼合。
 *
 * 单独成模块而不是放在 `DesktopNotificationCenter` 里：可达集合由 AgentController
 * 枚举，通知目标由 Notification 领域持有，两边都需要同一套拼法。放在任一侧都会
 * 造成反向依赖，因此收敛成一个不含业务状态的纯函数模块。
 *
 * 用 `\u0000` 而不是 `:` 分隔：Agent、Workspace、Session 标识都可能含 `:`，
 * 用冒号拼合会让不同目标碰撞成同一个键。
 */

/** 拼合一条 Agent Session 通知目标的可达键。 */
export function get_agent_session_target_key(agent_id: string, workspace_id: string, session_id: string): string {
  return `${agent_id}\u0000${workspace_id}\u0000${session_id}`;
}

/** 拼合一条 GroupSession 通知目标的可达键。 */
export function get_group_session_target_key(group_id: string, session_id: string): string {
  return `${group_id}\u0000${session_id}`;
}
