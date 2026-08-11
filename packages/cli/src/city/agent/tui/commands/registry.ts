/**
 * city agent chat TUI 内置 slash 命令注册表。
 */

import type { SlashCommand } from "@/city/agent/tui/commands/types.js";

/**
 * 内置 slash 命令列表。
 */
export const BUILTIN_SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: "help",
    aliases: ["h", "?"],
    description: "Show available commands and shortcuts",
    availability: "always",
  },
  {
    name: "quit",
    aliases: ["exit"],
    description: "Exit agent chat",
    availability: "always",
  },
  {
    name: "clear",
    aliases: [],
    description: "Clear the transcript",
    availability: "idle-only",
  },
  {
    name: "new",
    aliases: [],
    description: "Start a fresh session",
    availability: "idle-only",
  },
  {
    name: "session",
    aliases: ["sessions"],
    description: "Browse and switch sessions",
    availability: "idle-only",
  },
  {
    name: "security",
    aliases: [],
    description: "Choose the current Session security policy",
    availability: "always",
  },
  {
    name: "model",
    aliases: ["models"],
    description: "Choose the current Session model (/model [model-id])",
    availability: "idle-only",
  },
  {
    name: "attach",
    aliases: ["file"],
    description: "Open the system file picker and attach files to the next message",
    availability: "always",
  },
  {
    name: "approve",
    aliases: ["a"],
    description: "Approve an unrestricted sandbox request (/approve <approval_id>)",
    availability: "always",
  },
  {
    name: "deny",
    aliases: ["d"],
    description: "Deny an unrestricted sandbox request (/deny <approval_id>)",
    availability: "always",
  },
];

/**
 * 根据名称查找内置 slash 命令（支持别名）。
 *
 * @param name 命令名称或别名。
 * @returns 匹配的命令；未找到时返回 undefined。
 */
export function findBuiltInSlashCommand(name: string): SlashCommand | undefined {
  return BUILTIN_SLASH_COMMANDS.find(
    (command) => command.name === name || command.aliases.includes(name),
  );
}
