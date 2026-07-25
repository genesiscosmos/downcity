/**
 * 从 assistant message 中提取“用户可见文本”。
 *
 * 背景（中文，关键点）
 * - 在 tool-strict 模式下，模型的 `result.text` 可能为空
 * - 真实的“最终回复”往往由 `chat_send` 工具的 input.text 决定
 * - 因此需要一个稳定的、与 Agent 解耦的提取逻辑（属于 chat/egress 语义）
 */

import {
  is_session_message_record,
  type SessionRecordV1,
  type SessionMessageRecordV1,
} from "@/executor/types/SessionRecords.js";
import {
  extractTextFromUiMessage,
  extract_tool_calls_from_ui_message,
} from "./UIMessageTransformer.js";

/**
 * 生成真正应该落盘到 session 的 assistant message。
 *
 * 关键点（中文）
 * - session 正式历史应尽量保留 AI SDK 最终 assistant UIMessage。
 * - 运行中 step/tool 的中断恢复由 inflight 快照承担，不再通过跳过最终 message 收口。
 */
export function resolve_assistant_message_for_persistence(
  message: SessionRecordV1 | null | undefined,
): SessionMessageRecordV1 | null {
  if (!message || typeof message !== "object") return null;
  if (!is_session_message_record(message)) return null;
  return message;
}

/**
 * 提取策略（中文）
 * - 倒序扫描：优先使用最后一次 `chat_send`，与最终用户感知一致。
 * - 优先使用 chat_send 的 input.text（需结合 tool output 判断成功）。
 * - 若 tool output 为空/非 JSON，走 best-effort 采用 input.text。
 * - 若无 tool call，则回退到 message 文本内容。
 */
export function pick_last_successful_chat_send_text(
  message: SessionRecordV1 | null | undefined,
): string {
  if (!is_session_message_record(message)) return "";
  const toolCalls = extract_tool_calls_from_ui_message(message);
  // 关键点（中文）：优先从 chat_send 的 input.text 还原"用户可见回复"。
  for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
    const tc = toolCalls[i];
    if (!tc) continue;
    if (String(tc.tool || "") !== "chat_send") continue;

    const inputText = tc.input ? tc.input.text : undefined;
    const text = (typeof inputText === "string" ? inputText : "").trim();
    if (!text) continue;

    const raw = String(tc.output || "").trim();
    if (!raw) return text; // 无输出时 best-effort 认为成功

    try {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as { success?: boolean }).success === true
      ) {
        return text;
      }
    } catch {
      // unknown format：best-effort 使用 text
      return text;
    }
  }
  return extractTextFromUiMessage(message);
}
