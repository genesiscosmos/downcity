/**
 * Shell tool 辅助函数。
 *
 * 关键点（中文）
 * - 这里只保留 shell tool 自身的输入保护逻辑。
 * - 不解析 Agent 私有输出协议，不向 session 注入消息。
 */

/**
 * 对聊天发送命令做前置安全校验。
 */
export function validateChatSendCommand(cmd: string): string | null {
  const source = String(cmd ?? "");
  if (!/\b(?:bay|downcity)\s+chat\s+send\b/.test(source)) return null;
  if (!/[\r\n]/.test(source)) return null;
  if (/\b(?:bay|downcity)\s+chat\s+send\b[\s\S]*\s--stdin(?:\s|$)/.test(source)) {
    return null;
  }
  if (/\b(?:bay|downcity)\s+chat\s+send\b[\s\S]*\s--text(?:\s|$)/.test(source)) {
    return null;
  }
  if (/\b(?:bay|downcity)\s+chat\s+send\b[\s\S]*\s--text-file(?:\s|$)/.test(source)) {
    return null;
  }
  return [
    "Unsafe chat send command: real newlines are not allowed.",
    "If your message is multi-line, use chat send --stdin, --text-file, or explicit --text.",
  ].join(" ");
}
