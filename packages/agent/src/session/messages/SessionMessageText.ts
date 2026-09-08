/**
 * Canonical SessionMessage 文本与工具摘要读取器。
 *
 * 该模块只读取 Session 持久化事实，供标题、预览和外部时间线复用。
 */

import type {
  SessionAgentMessage,
  SessionMessage,
} from "@downcity/type";
import type { JsonObject, JsonValue } from "@downcity/type";

/** Session 工具调用的只读摘要。 */
export interface SessionToolCallSummary {
  /** 工具注册名称。 */
  tool_name: string;
  /** 工具结构化输入。 */
  input: JsonObject;
  /** 工具成功输出或失败信息。 */
  output: JsonValue;
  /** 工具是否已成功完成。 */
  succeeded: boolean;
}

/** 提取单条 canonical Message 的全部普通文本。 */
export function extract_session_message_text(message: SessionMessage): string {
  if (message.type !== "user" && message.type !== "agent") return "";
  return message.parts
    .flatMap((part) => part.type === "text" ? [part.text] : [])
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** 提取 Assistant Message 中的 canonical 工具调用摘要。 */
export function extract_session_tool_calls(
  message: SessionAgentMessage,
): SessionToolCallSummary[] {
  return message.parts.flatMap((part) => {
    if (part.type !== "tool" || part.input === undefined) return [];
    return [{
      tool_name: part.tool_name,
      input: to_json_object(part.input),
      output: part.state === "failed"
        ? { error: part.error || "tool_error" }
        : part.output ?? null,
      succeeded: part.state === "completed",
    }];
  });
}

/** 读取最终一次成功 `chat_send` 的可见文本，并回退到普通 Assistant 文本。 */
export function resolve_session_assistant_visible_text(
  message: SessionAgentMessage,
): string {
  const calls = extract_session_tool_calls(message);
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (call.tool_name !== "chat_send") continue;
    const text = typeof call.input.text === "string" ? call.input.text.trim() : "";
    if (text && call.succeeded) return text;
  }
  return extract_session_message_text(message);
}

/** 把工具输入收窄为 JSON 对象。 */
function to_json_object(value: JsonValue): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return { value };
}
