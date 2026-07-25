/**
 * Session 消息预览投影。
 *
 * 关键点（中文）
 * - 只负责从单条持久化 record 提取用户可见文本。
 * - history store 与浏览层共用该投影，避免摘要写入和读取采用不同规则。
 */

import {
  getToolName,
  isToolUIPart,
  type UIMessagePart,
} from "ai";
import { pick_last_successful_chat_send_text } from "@/executor/messages/UserVisibleText.js";
import type {
  SessionMessageRecordV1,
  SessionRecordV1,
} from "@/executor/types/SessionRecords.js";
import {
  is_session_action_record,
  is_session_message_record,
} from "@/executor/types/SessionRecords.js";

type SessionPreviewPart = UIMessagePart<
  Record<string, never>,
  Record<string, never>
>;

function extract_message_text(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const texts: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const text_part = part as { type?: unknown; text?: unknown };
    if (text_part.type !== "text" || typeof text_part.text !== "string") continue;
    const text = text_part.text.trim();
    if (text) texts.push(text);
  }
  return texts.join("\n").trim();
}

function extract_assistant_tool_summary(
  message: SessionMessageRecordV1,
): string {
  if (!Array.isArray(message.parts)) return "";
  const tool_names = new Set<string>();
  for (const part of message.parts as SessionPreviewPart[]) {
    if (!part || typeof part !== "object" || !isToolUIPart(part)) continue;
    const tool_name = String(getToolName(part) || "").trim();
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
  message: SessionRecordV1,
): string {
  if (is_session_action_record(message)) {
    return message.description
      ? `${message.title}\n${message.description}`
      : message.title;
  }
  if (!is_session_message_record(message)) return "";
  const plain_text = extract_message_text(message.parts);
  if (plain_text) return plain_text;
  if (message.role !== "assistant") return "";

  const user_visible = pick_last_successful_chat_send_text(message).trim();
  return user_visible || extract_assistant_tool_summary(message);
}
