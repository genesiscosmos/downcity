/**
 * city agent chat TUI slash 命令模块统一导出。
 */

export type {
  ParsedSlashInput,
  SlashCommand,
  SlashCommandAvailability,
  SlashCommandIntent,
} from "@/city/agent/tui/commands/types.js";
export { parseSlashInput } from "@/city/agent/tui/commands/parse.js";
export {
  BUILTIN_SLASH_COMMANDS,
  findBuiltInSlashCommand,
} from "@/city/agent/tui/commands/registry.js";
export {
  resolveSlashCommandInput,
  type ResolveSlashCommandOptions,
} from "@/city/agent/tui/commands/resolve.js";
export { dispatchSlashCommand } from "@/city/agent/tui/commands/dispatch.js";
export type { SlashCommandHost } from "@/city/agent/tui/commands/host.js";
