/**
 * city agent chat TUI slash 意图解析。
 */

import { findBuiltInSlashCommand } from "@/city/agent/tui/commands/registry.js";
import type {
  SlashCommand,
  SlashCommandAvailability,
  SlashCommandIntent,
} from "@/city/agent/tui/commands/types.js";

/**
 * 意图解析选项。
 */
export interface ResolveSlashCommandOptions {
  /** 用户输入文本。 */
  readonly input: string;

  /** 当前是否正在流式输出/执行中。 */
  readonly is_streaming: boolean;
}

/**
 * 计算命令实际可用性。
 *
 * @param command slash 命令。
 * @param args 当前参数。
 * @returns 实际可用性。
 */
function resolve_availability(
  command: SlashCommand,
  args: string,
): SlashCommandAvailability {
  if (typeof command.availability === "function") {
    return command.availability(args);
  }
  return command.availability ?? "always";
}

/**
 * 把用户输入解析为 slash 意图。
 *
 * @param options 解析选项。
 * @returns 解析后的意图。
 */
export function resolveSlashCommandInput(
  options: ResolveSlashCommandOptions,
): SlashCommandIntent {
  if (!options.input.startsWith("/")) {
    return { kind: "not-command", input: options.input };
  }

  const trimmed = options.input.slice(1).trim();
  if (trimmed.length === 0) {
    // 用户只输入了 "/"，当作普通消息处理。
    return { kind: "message", input: options.input };
  }

  const space_index = trimmed.indexOf(" ");
  const name = space_index === -1 ? trimmed : trimmed.slice(0, space_index);
  const args = space_index === -1 ? "" : trimmed.slice(space_index + 1).trim();

  const command = findBuiltInSlashCommand(name);
  if (command === undefined) {
    // 未知 slash 命令：回退为普通用户消息，让 agent 看到 /foo 原文。
    return { kind: "message", input: options.input };
  }

  const availability = resolve_availability(command, args);
  if (availability === "idle-only" && options.is_streaming) {
    return {
      kind: "blocked",
      command_name: name,
      reason: "streaming",
    };
  }

  return {
    kind: "builtin",
    command,
    name,
    args,
  };
}
