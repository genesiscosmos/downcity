/**
 * SessionMessageLog：assistant 消息日志提取与输出辅助模块。
 *
 * 关键点（中文）
 * - 只负责从 session message 中提取可读文本。
 * - 只负责把最终 assistant 文本稳定写入统一 logger。
 * - 不参与模型消息转换，也不感知附件注入逻辑。
 */

import { isTextUIPart } from "ai";
import type { Logger } from "@/utils/logger/Logger.js";
import type { SessionMessageRecordV1 } from "@/executor/types/SessionRecords.js";

/**
 * 从 UI message 中提取 assistant 文本部分。
 */
export function extract_assistant_text_for_log(
  message: SessionMessageRecordV1,
): string {
  if (!Array.isArray(message.parts)) return "";
  return message.parts
    .filter(isTextUIPart)
    .map((part) => String(part.text ?? ""))
    .join("\n")
    .trim();
}

/**
 * 立即输出 assistant 文本日志。
 */
export async function log_assistant_message_now(
  logger: Logger,
  message: SessionMessageRecordV1,
): Promise<void> {
  const text = extract_assistant_text_for_log(message) || "-";
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const out = [`[assistant] ${lines[0] || "-"}`];
  if (lines.length > 1) out.push(...lines.slice(1));
  await logger.log("info", out.join("\n"));
}
