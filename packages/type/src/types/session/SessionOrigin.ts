/**
 * Session 来源元数据。
 *
 * Session 始终归 Agent 所有。来源类型同时承担业务分类与物理存储分区职责。
 * 角色只有少数几个稳定值：Agent 主对话、外部聊天、工作会话、任务会话、群聊会话；
 * 其他调用方也可以声明自己的稳定类型。
 *
 * 关键点（中文）
 * - `agent` 角色的 `session_id` 等于 Agent 的 `id`：会话由它属于谁来标识。
 * - `work` 是默认角色：一段会话的存在意义就是干活。
 */

import type { JsonValue } from "../json/Json.js";

/** Agent 自己那条会话的来源类型。 */
export const SESSION_ORIGIN_TYPE_AGENT = "agent";

/** 每个外部聊天独有、归绑定 Agent 所有的会话来源类型。 */
export const SESSION_ORIGIN_TYPE_CHANNEL = "channel";

/** 工作会话的来源类型，也是未指定角色时的默认值。 */
export const SESSION_ORIGIN_TYPE_WORK = "work";

/** Session 的创建来源。 */
export type SessionOrigin = {
  /**
   * 来源类型，同时作为 Session Store 的一级分区名。
   *
   * 该值必须是非空字符串；`agent` 表示 Agent 主对话，`channel` 表示外部聊天，
   * `work` 表示普通工作会话，
   * 其他稳定值由创建方定义。
   */
  readonly type: string;
  /**
   * 创建方附加的可序列化来源信息。
   *
   * 除 `type` 外的字段由创建方拥有、校验和解释，Agent 核心只负责完整持久化。
   */
  readonly [key: string]: JsonValue;
};

/** 规范化一个 Session 来源类型。 */
export function normalize_session_origin_type(input: unknown): string {
  const origin_type = typeof input === "string" ? input.trim() : "";
  if (!origin_type) throw new Error("Session origin.type requires a non-empty string");
  return origin_type;
}

/** 规范化创建输入；未指定来源时使用默认工作会话角色。 */
export function normalize_session_origin(input?: SessionOrigin): SessionOrigin {
  const source = input ?? { type: SESSION_ORIGIN_TYPE_WORK };
  let serialized: unknown;
  try {
    serialized = JSON.parse(JSON.stringify(source));
  } catch {
    throw new Error("Session origin must be a JSON object");
  }
  if (!serialized || typeof serialized !== "object" || Array.isArray(serialized)) {
    throw new Error("Session origin must be a JSON object");
  }
  const origin = serialized as Record<string, JsonValue>;
  return {
    ...origin,
    type: normalize_session_origin_type(origin.type),
  };
}

/** 判断一个来源是否表示 Agent 自己的会话。 */
export function is_agent_session_origin(
  origin: { type?: string } | undefined,
): boolean {
  return String(origin?.type || "").trim() === SESSION_ORIGIN_TYPE_AGENT;
}

/** 恢复 Metadata，并校验来源与目标物理分区一致。 */
export function restore_session_origin(
  input: unknown,
  expected_origin_type: string,
): SessionOrigin {
  if (!input) throw new Error("Session metadata requires origin");
  const origin = normalize_session_origin(input as SessionOrigin);
  const normalized_expected = normalize_session_origin_type(expected_origin_type);
  if (origin.type !== normalized_expected) {
    throw new Error(
      `Session origin "${origin.type}" does not match storage partition "${normalized_expected}"`,
    );
  }
  return origin;
}
