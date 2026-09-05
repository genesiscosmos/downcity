/**
 * Desktop Chat 进程内缓存键编码。
 *
 * 每个动态字段都使用 UTF-16 长度前缀编码，避免 Workspace、Agent、Group 或
 * Session 标识包含分隔符时产生组合键碰撞。类型标签同时隔离 Agent 与 Group Chat。
 */

/** 将任意标识编码为可无歧义拼接的缓存键字段。 */
function encode_cache_key_part(value: string): string {
  return `${String(value.length)}:${value}`;
}

/** 生成不会因任意标识内容而碰撞的 Agent Session 缓存键。 */
export function get_session_key(workspace_id: string, agent_id: string, session_id: string): string {
  return `session|${encode_cache_key_part(workspace_id)}|${encode_cache_key_part(agent_id)}|${encode_cache_key_part(session_id)}`;
}

/** 生成与 Agent Session 隔离且不会碰撞的 Group Chat 缓存键。 */
export function get_group_chat_key(workspace_id: string, group_id: string, session_id: string): string {
  return `group|${encode_cache_key_part(workspace_id)}|${encode_cache_key_part(group_id)}|${encode_cache_key_part(session_id)}`;
}

/** 返回一个 Workspace 下 Agent 与 Group Chat 的完整缓存键前缀。 */
export function get_workspace_chat_key_prefixes(workspace_id: string): readonly string[] {
  const workspace_part = encode_cache_key_part(workspace_id);
  return [`session|${workspace_part}|`, `group|${workspace_part}|`];
}
