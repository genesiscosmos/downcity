/**
 * Session 消息预览投影。
 *
 * 关键点（中文）
 * - 只负责从单条 canonical Message 提取用户可见文本。
 * - history store 与浏览层共用该投影，避免摘要写入和读取采用不同规则。
 */

import {
  extract_session_message_text,
  resolve_session_assistant_visible_text,
} from "@/session/messages/SessionMessageText.js";
import type { SessionMessage } from "@downcity/type";

function extract_assistant_tool_summary(message: Extract<SessionMessage, { type: "assistant" }>): string {
  const tool_names = new Set<string>();
  for (const part of message.parts) {
    if (part.type !== "tool") continue;
    const tool_name = part.tool_name.trim();
    if (tool_name) tool_names.add(tool_name);
  }
  return tool_names.size > 0
    ? `[tool] ${Array.from(tool_names).join(", ")}`
    : "";
}

/**
 * 解析单条 session record 的用户可见预览文本。
 */
export function resolve_session_message_preview(
  message: SessionMessage,
): string {
  if (message.type === "action") {
    return message.description
      ? `${message.title}\n${message.description}`
      : message.title;
  }
  if (message.type === "error") return message.message;
  const plain_text = extract_session_message_text(message);
  if (plain_text) return plain_text;
  if (message.type !== "assistant") return "";

  const user_visible = resolve_session_assistant_visible_text(message).trim();
  return user_visible || extract_assistant_tool_summary(message);
}
