/**
 * Canonical Assistant Part 日志输出辅助。
 *
 * 该模块只提取可见文本并写入统一 Logger，不参与协议转换或持久化。
 */

import type { SessionAgentMessagePart } from "@downcity/type";
import type { Logger } from "@/utils/logger/Logger.js";

/** 从 canonical Assistant Parts 提取可见文本。 */
export function extract_assistant_text_for_log(
  parts: readonly SessionAgentMessagePart[],
): string {
  return parts
    .flatMap((part) => part.type === "text" ? [part.text] : [])
    .join("\n")
    .trim();
}

/** 立即输出 Assistant 文本日志。 */
export async function log_assistant_message_now(
  logger: Logger,
  parts: readonly SessionAgentMessagePart[],
): Promise<void> {
  const text = extract_assistant_text_for_log(parts) || "-";
  const lines = text.replace(/\r\n/gu, "\n").split("\n");
  await logger.log("info", [`[assistant] ${lines[0] || "-"}`, ...lines.slice(1)].join("\n"));
}
