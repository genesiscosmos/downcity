/**
 * Desktop 命令面板的注册表。
 *
 * 命令由多个不相邻的组件贡献，因此注册表是模块级单体，而不是某个 domain store 的字段。
 * 注册表为 `useSyncExternalStore` 提供稳定快照：`get_snapshot()` 在无变更时必须返回同一引用。
 */

import type { CommandDefinition } from "./types.ts";

/** 注册表行为选项。 */
export interface CommandRegistryOptions {
  /**
   * 是否把命令 id 冲突视为致命错误。
   *
   * 开发构建下为 true：新命令接入时立刻暴露冲突。
   * 生产构建下为 false：记录错误并跳过冲突项，避免注册阶段抛错导致整棵子树渲染失败、应用白屏。
   */
  strict?: boolean;
}

/** 读取 Vite 注入的开发构建标记；非 Vite 环境（Node 测试）返回 false。 */
function detect_strict_mode(): boolean {
  return Boolean(import.meta.env?.DEV);
}

/** 命令注册表；一个应用内只需要一个实例。 */
export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();
  private readonly listeners = new Set<() => void>();
  private readonly strict: boolean;
  private snapshot: readonly CommandDefinition[] = [];

  constructor(options: CommandRegistryOptions = {}) {
    this.strict = options.strict ?? false;
  }

  /**
   * 注册一批命令，返回只撤销这一批的注销函数。
   *
   * 冲突处理：strict 下抛错且注册表完全不变（原子语义）；非 strict 下跳过冲突项、
   * 保留已注册者，且注销函数不会误删他人注册的同 id 命令。
   */
  register(commands: readonly CommandDefinition[]): () => void {
    if (commands.length === 0) return () => undefined;

    const conflicts = commands.filter((command) => this.commands.has(command.id));
    if (conflicts.length > 0) {
      const message = `Duplicate command id: ${conflicts.map((command) => command.id).join(", ")}`;
      if (this.strict) throw new Error(message);
      console.error(`[command-palette] ${message}`);
    }

    const registered_ids: string[] = [];
    for (const command of commands) {
      if (this.commands.has(command.id)) continue;
      this.commands.set(command.id, command);
      registered_ids.push(command.id);
    }
    if (registered_ids.length === 0) return () => undefined;
    this.emit();

    return () => {
      let removed = false;
      for (const id of registered_ids) {
        if (this.commands.delete(id)) removed = true;
      }
      if (removed) this.emit();
    };
  }

  /** 返回当前全部命令；引用在无变更时保持稳定。 */
  get_snapshot = (): readonly CommandDefinition[] => this.snapshot;

  /** 订阅注册表变化；返回取消订阅函数。 */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** 重建不可变快照并通知订阅者。 */
  private emit(): void {
    this.snapshot = [...this.commands.values()];
    for (const listener of this.listeners) listener();
  }
}

/** 应用级命令注册表；开发构建下启用冲突检测。 */
export const command_registry = new CommandRegistry({ strict: detect_strict_mode() });
