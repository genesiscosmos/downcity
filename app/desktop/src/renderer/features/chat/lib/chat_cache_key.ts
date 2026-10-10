/**
 * Desktop Chat 进程内缓存键编码。
 *
 * 每个动态字段都使用 UTF-16 长度前缀编码，避免 Workspace、Agent、Group 或
 * Session 标识包含分隔符时产生组合键碰撞。类型标签同时隔离 Agent 与 Group Chat。
 *
 * Session 键包含来源分区（`origin_type`）：SDK 里一个 Session 的身份是
 * `(origin.type, session_id)`，同一 `session_id` 可以合法地存在于多个分区。`work` 与
 * `agent` 两条会话因此在渲染层也是两个不同的缓存槽位，不会互相覆盖。
 */

import { SESSION_ORIGIN_TYPE_WORK } from "@downcity/type";

/** 将任意标识编码为可无歧义拼接的缓存键字段。 */
function encode_cache_key_part(value: string): string {
  return `${String(value.length)}:${value}`;
}

/**
 * 生成不会因任意标识内容而碰撞的 Agent Session 缓存键。
 *
 * `origin_type` 省略时按默认工作分区；草稿尚未落盘，没有分区概念。
 */
export function get_session_key(workspace_id: string, agent_id: string, session_id: string, origin_type?: string): string {
  return `session|${encode_cache_key_part(workspace_id)}|${encode_cache_key_part(agent_id)}|${encode_cache_key_part(session_id)}|${encode_cache_key_part(origin_type ?? SESSION_ORIGIN_TYPE_WORK)}`;
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

/** 判断完整 Chat 缓存键是否属于指定 Workspace。 */
export function is_workspace_chat_key(key: string, workspace_id: string): boolean {
  return get_workspace_chat_key_prefixes(workspace_id).some((prefix) => key.startsWith(prefix));
}
