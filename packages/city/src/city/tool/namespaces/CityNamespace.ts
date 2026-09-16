/**
 * City Tool namespace 基类。
 *
 * 关键点（中文）
 * - 一个 namespace 是一个对象，持有一组动作对象，并按名分发。
 * - namespace 只声明与执行，不感知可见性判定与结果信封。
 * - 新增 namespace 就是新增一个子类文件，并在 `namespaces/index.ts` 注册一次。
 */

import type { CityAction } from "@/city/tool/namespaces/CityAction.js";

/** city tool 的一个 namespace。 */
export abstract class CityNamespace {
  /** namespace 名，snaker。 */
  abstract readonly namespace: string;

  /** namespace 用途的一行摘要，进入模型侧描述。 */
  abstract readonly summary: string;

  /** 当前 namespace 的全部动作，顺序即模型侧索引顺序。 */
  protected abstract readonly actions: readonly CityAction[];

  /** 按名取动作；不存在时返回 null。 */
  action(action_input: string): CityAction | null {
    const action_name = String(action_input || "").trim();
    if (!action_name) return null;
    return this.actions.find((item) => item.action === action_name) ?? null;
  }

  /** 当前 namespace 是否包含敏感动作。 */
  is_sensitive(): boolean {
    return this.actions.some((item) => item.sensitivity === "sensitive");
  }

  /** 本 namespace 对模型侧索引的自描述。 */
  describe(): Record<string, unknown> {
    return {
      namespace: this.namespace,
      summary: this.summary,
      actions: this.actions.map((item) => item.action),
    };
  }

  /** 本 namespace 的动作索引。 */
  describe_actions(): Record<string, unknown>[] {
    return this.actions.map((item) => item.describe());
  }

  /** 本 namespace 全部动作名。 */
  action_names(): string[] {
    return this.actions.map((item) => item.action);
  }
}
