/**
 * city agent chat TUI slash 命令类型定义。
 *
 * 关键点（中文）
 * - 完全参考 Kimi Code 的 commands/types.ts，但只保留 downcity 所需的最小子集。
 * - 所有命令统一走 intent 解析，再分发到对应 handler。
 */

import type { AutocompleteItem } from "@earendil-works/pi-tui";

/**
 * slash 命令可用性策略。
 */
export type SlashCommandAvailability = "always" | "idle-only";

/**
 * 单个内置 slash 命令定义。
 */
export interface SlashCommand {
  /** 命令主名称。 */
  readonly name: string;

  /** 命令别名列表。 */
  readonly aliases: readonly string[];

  /** 命令描述，用于自动完成面板。 */
  readonly description: string;

  /**
   * 可用性策略。
   * - "always"：随时可用。
   * - "idle-only"：仅在非流式/非执行态可用。
   * 也可以是函数，根据参数决定。
   */
  readonly availability?:
    | SlashCommandAvailability
    | ((args: string) => SlashCommandAvailability);

  /**
   * 参数自动完成回调。
   *
   * @param argument_prefix 当前已输入的参数前缀。
   * @returns 候选项或 null。
   */
  readonly get_argument_completions?: (
    argument_prefix: string,
  ) => AutocompleteItem[] | null;
}

/**
 * 解析后的 slash 输入。
 */
export interface ParsedSlashInput {
  /** 命令名称。 */
  readonly name: string;

  /** 命令参数（已 trim）。 */
  readonly args: string;
}

/**
 * slash 命令解析意图联合类型。
 */
export type SlashCommandIntent =
  | { readonly kind: "not-command"; readonly input: string }
  | { readonly kind: "message"; readonly input: string }
  | {
      readonly kind: "builtin";
      readonly command: SlashCommand;
      readonly name: string;
      readonly args: string;
    }
  | { readonly kind: "invalid"; readonly command_name: string }
  | {
      readonly kind: "blocked";
      readonly command_name: string;
      readonly reason: "streaming";
    };
