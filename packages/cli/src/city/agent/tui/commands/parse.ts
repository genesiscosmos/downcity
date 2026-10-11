/**
 * city agent chat TUI slash 输入解析。
 */

import type { ParsedSlashInput } from "@/city/agent/tui/commands/types.js";

/**
 * 解析 slash 命令输入。
 *
 * @param input 用户输入文本。
 * @returns 解析结果；不是 slash 命令时返回 null。
 */
export function parseSlashInput(input: string): ParsedSlashInput | null {
  if (!input.startsWith("/")) {
    return null;
  }

  const trimmed = input.slice(1).trim();
  if (trimmed.length === 0) {
    return null;
  }

  const space_index = trimmed.indexOf(" ");
  const name = space_index === -1 ? trimmed : trimmed.slice(0, space_index);
  const args = space_index === -1 ? "" : trimmed.slice(space_index + 1).trim();

  // 名称中不能包含 /，避免误解析 URL。
  if (name.includes("/")) {
    return null;
  }

  return { name, args };
}
