/**
 * Desktop 命令面板的注册与求值 Hooks。
 *
 * 注册表是模块级单体（见 registry.ts），因此这里只提供两个边界：
 * - `use_register_commands`：把一组命令的生命周期绑定到调用组件的挂载周期；
 * - `use_commands`：订阅注册表并按当前上下文过滤 / 排序。
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { filter_and_rank, type CommandGroupLabels } from "./filter.ts";
import { command_registry } from "./registry.ts";
import type { CommandContext, CommandDefinition, RankedCommand } from "./types.ts";

/**
 * 注册一组命令，并在依赖变化或组件卸载时注销。
 *
 * 依赖由调用方显式控制；React StrictMode 的双次执行会得到「注册 → 注销 → 注册」
 * 的正确序列，注册表在严格模式下也能识别出真正的 id 冲突。
 */
export function use_register_commands(
  create_commands: () => readonly CommandDefinition[],
  dependencies: React.DependencyList,
): void {
  useEffect(() => command_registry.register(create_commands()), dependencies);
}

/** 订阅注册表并返回当前上下文下的可见命令。 */
export function use_commands(
  query: string,
  context: CommandContext,
  group_labels: CommandGroupLabels,
): readonly RankedCommand[] {
  const commands = useSyncExternalStore(
    command_registry.subscribe,
    command_registry.get_snapshot,
    command_registry.get_snapshot,
  );

  return useMemo(
    () => filter_and_rank(commands, query, context, group_labels),
    [commands, context, group_labels, query],
  );
}
