/**
 * LLM 请求/响应日志格式化的共享基础能力。
 *
 * 关键点（中文）
 * - 这里只放与 provider 无关的 JSON/文本抽取能力。
 * - 请求侧和响应侧各自的业务规则放到独立模块，避免继续堆成单文件巨石。
 */

import type { JsonObject, JsonValue } from "@/types/common/Json.js";

/**
 * 允许被识别为日志 payload 的解析结果。
 */
export type ParsedPayload = JsonObject | JsonValue[];

function isJsonObjectLike(value: JsonValue | null | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function is_json_object(value: JsonValue | null | undefined): value is JsonObject {
  return isJsonObjectLike(value);
}

export function get_string_field(
  objectValue: JsonObject,
  field: string,
): string | undefined {
  const value = objectValue[field];
  return typeof value === "string" ? value : undefined;
}

export function get_object_field(
  objectValue: JsonObject,
  field: string,
): JsonObject | undefined {
  const value = objectValue[field];
  return isJsonObjectLike(value) ? value : undefined;
}

export function get_array_field(
  objectValue: JsonObject,
  field: string,
): JsonValue[] | undefined {
  const value = objectValue[field];
  return Array.isArray(value) ? value : undefined;
}

export function safe_json_parse(input: string | undefined): ParsedPayload | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(trimmed) as JsonValue;
    return isJsonObjectLike(parsed) || Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `…(truncated, ${text.length} chars total)`;
}

export function stringify_compact(
  value: JsonValue | object | undefined,
  maxChars: number,
): string {
  try {
    return truncate(JSON.stringify(value), maxChars);
  } catch {
    return truncate(String(value), maxChars);
  }
}

export function to_inline_log_value(value: string, maxChars: number): string {
  return truncate(String(value || ""), maxChars).replace(/\r?\n/g, "\\n");
}

export function format_log_field(key: string, value: string): string {
  return `[${key}] ${value}`;
}

function normalizeAttrKey(input: string): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
}

function normalizeAttrValue(input: string): string {
  return String(input || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[\]\[]/g, "");
}

export function push_labeled_text_block(
  out: string[],
  label: "system" | "user" | "assistant" | "tool" | "tool_result",
  text: string,
  maxChars: number,
  attrs?: string[],
): void {
  // 关键点（中文）：日志按“每条消息一段”输出，段内换行转义为字面量 `\n`，保证紧凑且可分段。
  const normalized = truncate(String(text || "-"), maxChars)
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, "\\n");
  const headLabel =
    Array.isArray(attrs) && attrs.length > 0 ? `${label} ${attrs.join(" ")}` : label;
  out.push(format_log_field(headLabel, normalized || "-"));
}

export function parse_info_block_text(value: string): {
  info: Record<string, string>;
  body: string;
} | null {
  const normalized = String(value || "").replace(/\r\n/g, "\n").trim();
  if (!normalized.startsWith("<info>\n")) return null;
  const matched = normalized.match(/^<info>\n([\s\S]*?)\n<\/info>(?:\n\n([\s\S]*))?$/);
  if (!matched) return null;

  const info: Record<string, string> = {};
  for (const rawLine of String(matched[1] || "").split("\n")) {
    const line = String(rawLine || "").trim();
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = normalizeAttrKey(line.slice(0, index));
    const fieldValue = normalizeAttrValue(line.slice(index + 1));
    if (!key || !fieldValue) continue;
    info[key] = fieldValue;
  }

  return {
    info,
    body: String(matched[2] || "").trim(),
  };
}

export function build_info_attrs(info: Record<string, string>): string[] {
  const preferredOrder = [
    "message_id",
    "user_id",
    "username",
    "role_id",
    "permissions",
    "received_at",
    "user_timezone",
    "channel",
    "session_id",
    "context_id",
    "chat_key",
    "chat_id",
    "chat_type",
    "thread_id",
  ];

  const attrs: string[] = [];
  for (const key of preferredOrder) {
    const value = String(info[key] || "").trim();
    if (!value || value === "unknown" || value === "none") continue;
    attrs.push(`${key}=${value}`);
  }
  for (const [key, raw] of Object.entries(info)) {
    if (preferredOrder.includes(key)) continue;
    const value = String(raw || "").trim();
    if (!value) continue;
    attrs.push(`${key}=${value}`);
  }
  return attrs;
}

export function content_to_text(content: JsonValue | undefined, maxChars: number): string {
  if (typeof content === "string") return truncate(content, maxChars);
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (!isJsonObjectLike(part)) return "";
        const partType = get_string_field(part, "type");
        // 关键点（中文）：OpenAI Responses 在 assistant 历史里常见 `output_text`，必须纳入日志提取，否则会显示为 `-`。
        if (
          partType === "text" ||
          partType === "input_text" ||
          partType === "output_text"
        ) {
          return String(get_string_field(part, "text") ?? "");
        }
        // 关键点（中文）：tool 事件由请求侧单独输出为 [tool]/[tool_result]，这里不混入文本。
        if (
          partType === "tool-approval-request" ||
          partType === "tool-call" ||
          partType === "tool-result" ||
          partType === "tool-error"
        ) {
          return "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
    return truncate(parts, maxChars);
  }
  if (isJsonObjectLike(content)) return stringify_compact(content, maxChars);
  return truncate(String(content ?? ""), maxChars);
}

export function parse_possible_json_object(
  value: JsonValue | undefined,
): JsonObject | undefined {
  if (isJsonObjectLike(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = safe_json_parse(value);
  return isJsonObjectLike(parsed) ? parsed : undefined;
}

export function extract_function_call_exec_command_cmd(
  message: JsonObject,
): string | undefined {
  const itemType = get_string_field(message, "type");
  if (itemType !== "function_call") return undefined;

  const name = get_string_field(message, "name");
  if (name !== "shell_session" && name !== "shell_exec") return undefined;

  const argsObj = parse_possible_json_object(message.arguments);
  if (!argsObj) return undefined;
  return get_string_field(argsObj, "cmd");
}

export function extract_messages(payload: JsonObject): JsonObject[] | null {
  const messages = get_array_field(payload, "messages");
  if (Array.isArray(messages)) {
    return messages.filter((item): item is JsonObject => isJsonObjectLike(item));
  }
  const input = get_array_field(payload, "input");
  if (Array.isArray(input)) {
    return input.filter((item): item is JsonObject => isJsonObjectLike(item));
  }
  return null;
}

export function extract_system_for_log(
  payload: JsonObject | undefined,
): JsonValue | undefined {
  if (!payload) return undefined;

  const system = payload.system;
  if (typeof system === "string" && system.trim()) return system;

  // 关键点（中文）：OpenAI Responses 请求把 system prompt 放在 `instructions` 字段。
  const instructions = get_string_field(payload, "instructions");
  if (typeof instructions === "string" && instructions.trim()) {
    return instructions;
  }

  return system;
}
