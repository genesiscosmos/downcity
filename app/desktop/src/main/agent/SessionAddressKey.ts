/**
 * Desktop Main 进程内的 Session 地址编码。
 *
 * ## 会话的身份是四元组，不是三元组
 *
 * SDK 里一个 Session 的身份是 `(origin.type, session_id)`，同一 `session_id` 可以同时
 * 存在于多个来源分区（`work` / `agent` / `task` / `group` …）。Desktop 作为宿主还必须
 * 再带上 `agent_id` 才能定位到具体 Agent 的会话，因此缓存键由四个字段构成：
 *
 * ```text
 * agent_id + workspace_id + session_id + origin_type
 * ```
 *
 * 少了 `origin_type` 就会把「Agent 自己的会话」（`session_id` 等于 `agent_id`）误当作
 * 某个 `work` 会话去读，SDK 会直接抛「Session not found in origin "work"」。
 *
 * ## 为什么单独成模块
 *
 * 键的拼法与拆法必须成对存在，且两边掌握的字段顺序必须一致。把拼、拆、规范化三件事
 * 收在一个纯函数模块里，`AgentController` 里就不会再出现 `session_key.split(":")[1]`
 * 这类靠位置约定的解析——那种写法每加一个字段都会静默错位。
 *
 * ## 分隔符与字段编码
 *
 * 用 `\u0000` 而不是 `:`：Agent、Workspace、Session 标识都可能含 `:`，用冒号拼合会让
 * 不同会话碰撞成同一个键。NUL 不可能出现在这些标识里（文件路径本身不允许 NUL），
 * 因此拼、拆都是无损的。
 */

import { SESSION_ORIGIN_TYPE_WORK, normalize_session_origin_type } from "@downcity/type";

/** 缓存键的字段分隔符；见文件头对分隔符选择的说明。 */
const session_address_separator = "\u0000";

/** 一个已解析的 Session 地址。 */
export interface SessionAddress {
  /** 所属 Agent 的稳定标识。 */
  agent_id: string;
  /** 会话绑定的 Workspace 标识；未绑定时为空串。 */
  workspace_id: string;
  /** 会话自身的稳定标识。 */
  session_id: string;
  /** 会话所在的来源分区。 */
  origin_type: string;
}

/**
 * 解析宿主传入的来源分区，缺省为默认工作分区。
 *
 * 缺省值与 SDK 自己的 `sessions.get(session_id, origin_type = SESSION_ORIGIN_TYPE_WORK)`
 * 保持一致；这里不根据 `session_id` 是否等于 `agent_id` 去猜测分区，因为同一标识
 * 合法地存在于多个分区，猜测会在边界上产生歧义。
 */
export function resolve_session_origin_type(origin_type?: string): string {
  const resolved = String(origin_type ?? "").trim();
  return resolved ? normalize_session_origin_type(resolved) : SESSION_ORIGIN_TYPE_WORK;
}

/** 拼合一个不会与其他 Session 冲突的进程内地址键。 */
export function get_session_cache_key(
  agent_id: string,
  workspace_id: string,
  session_id: string,
  origin_type?: string,
): string {
  return [
    String(agent_id || ""),
    String(workspace_id || ""),
    String(session_id || ""),
    resolve_session_origin_type(origin_type),
  ].join(session_address_separator);
}

/**
 * 拆开一个地址键；结构不完整时返回 `undefined`。
 *
 * 返回 `undefined` 而不是抛错：键既可能来自本模块，也可能来自旧版本落盘的设置，
 * 调用方按「不属于任何地址」处理比中断整轮清理更合适。
 */
export function parse_session_cache_key(key: string): SessionAddress | undefined {
  const parts = String(key || "").split(session_address_separator);
  if (parts.length !== 4) return undefined;
  const [agent_id, workspace_id, session_id, origin_type] = parts as [string, string, string, string];
  if (!agent_id || !session_id || !origin_type) return undefined;
  return { agent_id, workspace_id, session_id, origin_type };
}
