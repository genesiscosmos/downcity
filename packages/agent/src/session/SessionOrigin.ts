/**
 * AgentSession 来源规范化。
 *
 * 来源类型既是业务分类，也是 Session Store 的确定性物理分区。该模块统一保证
 * 类型非空、来源可序列化，并在恢复时校验目录分区与 Metadata 一致。
 */

import { to_session_json_object } from "@/session/messages/SessionJsonValue.js";
import type { SessionOrigin } from "@/types/session/SessionOrigin.js";

/** 规范化一个 Session 来源类型。 */
export function normalize_session_origin_type(input: unknown): string {
  const origin_type = typeof input === "string" ? input.trim() : "";
  if (!origin_type) throw new Error("Session origin.type requires a non-empty string");
  return origin_type;
}

/** 规范化创建输入；未指定来源时使用普通聊天分区。 */
export function normalize_session_origin(input?: SessionOrigin): SessionOrigin {
  const source = input ?? { type: "chat" };
  const serialized = to_session_json_object(source);
  if (!serialized) throw new Error("Session origin must be a JSON object");
  return {
    ...serialized,
    type: normalize_session_origin_type(serialized.type),
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
