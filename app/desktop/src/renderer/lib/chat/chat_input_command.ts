/** ChatInput 本地 Slash 命令识别。 */

import type { DesktopChatInput } from "@common/types/DesktopApi";

/** 当前由 ChatInput 直接处理、不发送给模型的命令。 */
export type ChatInputCommand = "compact";

/**
 * 只识别没有附件和引用的精确命令，避免把用户正文误判成本地操作。
 */
export function resolve_chat_input_command(input: DesktopChatInput): ChatInputCommand | undefined {
  if (input.files.length > 0 || (input.references?.length ?? 0) > 0) return undefined;
  return input.text.trim() === "/compact" ? "compact" : undefined;
}
