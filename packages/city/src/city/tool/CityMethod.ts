/**
 * City Tool method 基类。
 *
 * 关键点（中文）
 * - 一个 method 是 City 的一类能力，持有一组动作对象，并按名分发。
 * - method 只声明与执行，不感知结果信封与调用入口。
 * - `system` 与 `invoke` 是 method 级可选能力：
 *   `system` 提供注入 session system 的说明文本，`invoke` 提供不进模型工具清单的程序化入口。
 * - 新增一个 method 就是新增一个子类文件，并在 `methods/index.ts` 注册一次。
 */

import type { CityToolContext } from "@/city/types/CityTool.js";
import type { CityAction } from "@/city/tool/CityAction.js";

/** city tool 的一个 method。 */
export abstract class CityMethod {
  /** method 名，snaker。 */
  abstract readonly method: string;

  /** method 用途的一行摘要，进入模型侧描述。 */
  abstract readonly summary: string;

  /** 当前 method 的全部动作，顺序即模型侧索引顺序。 */
  protected abstract readonly actions: readonly CityAction[];

  /**
   * 注入 session system 的说明文本。
   *
   * 关键点（中文）
   * - 用于告诉模型这类能力的用法、代价与禁忌，一个来源，一处维护。
   * - 不需要说明的 method 保持默认空实现，不必覆写。
   */
  system(_context: CityToolContext): string | Promise<string> {
    return "";
  }

  /**
   * 供其他插件或宿主调用的程序化动作，不进入模型工具清单。
   *
   * 关键点（中文）
   * - 用于「能力归 City、触发归插件」的场景，例如 chat 入站自动转写。
   * - 与动作共享同一套执行上下文与错误语义：失败直接抛错。
   * - 未声明该方法的 method 不接受程序化调用。
   */
  invoke?(
    /** 动作名，snaker。 */
    action: string,
    /** 动作输入。 */
    input: unknown,
    /** 当前执行上下文。 */
    context: CityToolContext,
  ): Promise<unknown>;

  /** 按名取动作；不存在时返回 null。 */
  action(action_input: string): CityAction | null {
    const action_name = String(action_input || "").trim();
    if (!action_name) return null;
    return this.actions.find((item) => item.action === action_name) ?? null;
  }

  /** 本 method 对模型侧索引的自描述。 */
  describe(): Record<string, unknown> {
    return {
      method: this.method,
      summary: this.summary,
      actions: this.actions.map((item) => item.action),
    };
  }

  /** 本 method 的动作索引。 */
  describe_actions(): Record<string, unknown>[] {
    return this.actions.map((item) => item.describe());
  }

  /** 本 method 全部动作名。 */
  action_names(): string[] {
    return this.actions.map((item) => item.action);
  }
}
