/**
 * Memory 自动 Capture 的确定性预检策略。
 *
 * 只读取 canonical User/Assistant 文本；过滤失败 Turn、寒暄和明显敏感内容。
 * 本模块不执行 Formation，也不把 Recall、system 或隐藏推理写回 Memory。
 */

import type { SessionTurnCommittedHookValue } from "@downcity/agent";
import type { MemoryCaptureMessage } from "@/memory/types/Memory.js";

const IGNORED_USER_TEXT = new Set([
  "hi", "hello", "hey", "thanks", "thank you", "ok", "okay",
  "你好", "您好", "谢谢", "好的", "收到", "继续",
]);

const SENSITIVE_PATTERNS = [
  /\b(?:password|passwd|secret|access[_ -]?token|api[_ -]?key)\b\s*[:=]/iu,
  /\bsk-[a-z0-9_-]{12,}\b/iu,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/u,
];

/** 从成功 Turn 中提取允许持久化为 Capture Job 的最小文本证据。 */
export function select_memory_capture_messages(
  input: SessionTurnCommittedHookValue,
): MemoryCaptureMessage[] {
  if (input.status !== "completed" || !Array.isArray(input.messages)) return [];
  const messages = input.messages.flatMap((message) => {
    if (message.type !== "user" && message.type !== "agent") return [];
    const text = message.parts
      .flatMap((part) => part.type === "text" ? [String(part.text || "").trim()] : [])
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!text) return [];
    return [{
      message_id: message.message_id,
      role: message.type,
      text,
    } satisfies MemoryCaptureMessage];
  });
  const user_text = messages
    .filter((message) => message.role === "user")
    .map((message) => message.text)
    .join("\n")
    .trim();
  if (!user_text || IGNORED_USER_TEXT.has(user_text.toLowerCase())) return [];
  const combined_text = messages.map((message) => message.text).join("\n");
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(combined_text))) return [];
  return messages;
}
