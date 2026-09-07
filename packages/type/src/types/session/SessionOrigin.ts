/**
 * Session 来源元数据。
 *
 * Session 始终归 Agent 所有。来源类型同时承担业务分类与物理存储分区职责，
 * `chat` 是默认分区，Group、Task 或其他调用方可以声明自己的稳定类型。
 */

import type { JsonValue } from "../json/Json.js";

/** Session 的创建来源。 */
export type SessionOrigin = {
  /**
   * 来源类型，同时作为 Session Store 的一级分区名。
   *
   * 该值必须是非空字符串；`chat` 表示普通聊天，其他稳定值由创建方定义。
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

/** 规范化创建输入；未指定来源时使用普通聊天分区。 */
export function normalize_session_origin(input?: SessionOrigin): SessionOrigin {
  const source = input ?? { type: "chat" };
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
