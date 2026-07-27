/**
 * Session JSON 值归一化工具。
 *
 * Session 持久化边界只接受 JSON 值；无法直接序列化的输入降级为字符串，
 * 避免 Tool、User Data 等外部输入污染 canonical Message。
 */

import type { JsonObject, JsonValue } from "@/types/common/Json.js";
import type { SessionProviderMetadata } from "@/types/session/SessionMessage.js";

/** 把任意运行时输入转换为可持久化的 JSON 值。 */
export function to_session_json_value(input: unknown): JsonValue {
  if (input === undefined || input === null) return null;
  if (
    typeof input === "string" ||
    typeof input === "number" ||
    typeof input === "boolean"
  ) {
    return input;
  }
  try {
    return JSON.parse(JSON.stringify(input)) as JsonValue;
  } catch {
    return String(input);
  }
}

/** 把任意运行时输入转换为可持久化 JSON 对象，非对象输入返回 undefined。 */
export function to_session_json_object(input: unknown): JsonObject | undefined {
  if (!is_plain_object(input)) return undefined;
  try {
    const value = JSON.parse(JSON.stringify(input)) as unknown;
    return is_plain_object(value) ? value as JsonObject : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 把 AI SDK Provider metadata 规整为可持久化快照。
 *
 * 关键点（中文）
 * - ProviderMetadata 顶层是 provider ID 到 JSON 对象的映射。
 * - 新 metadata 代表完整快照，不在这里猜测 Provider 的字段合并语义。
 * - 非法 metadata 返回 undefined，由调用方保留已经持久化的旧快照。
 */
export function to_session_provider_metadata(
  input: unknown,
): SessionProviderMetadata | undefined {
  if (!is_plain_object(input)) return undefined;
  try {
    const value = JSON.parse(JSON.stringify(input)) as unknown;
    if (!is_plain_object(value)) return undefined;
    if (!Object.values(value).every(is_plain_object)) return undefined;
    return value as SessionProviderMetadata;
  } catch {
    return undefined;
  }
}

/** 判断未知值是否为普通对象。 */
function is_plain_object(input: unknown): input is Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}
