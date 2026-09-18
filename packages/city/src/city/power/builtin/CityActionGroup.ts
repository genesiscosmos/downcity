/**
 * City 动作组。
 *
 * 关键点（中文）
 * - 一个组是 City 的一类能力，例如 `env`、`sandbox`、`image`、`sound`。
 * - 组只负责把内部动作组织成点号 id，并向模型提供一段组说明；
 *   它不参与分发，也不感知结果信封。
 * - 组说明是静态文本，不依赖执行上下文，因此注册期即可确定。
 * - 新增一个组就是新增一个子类文件，并在 `groups/index.ts` 注册一次。
 */

import type { AnyCityAction } from "@/city/power/builtin/CityAction.js";

/** city power 的一个动作组。 */
export abstract class CityActionGroup {
  /** 组名，snaker；同时是动作 id 的前缀。 */
  abstract readonly group: string;

  /** 组用途的一行摘要，进入模型侧描述。 */
  abstract readonly summary: string;

  /** 当前组的全部动作，顺序即模型侧索引顺序。 */
  protected abstract readonly actions: readonly AnyCityAction[];

  /**
   * 注入 session system 的说明文本。
   *
   * 关键点（中文）
   * - 用于告诉模型这类能力的用法、代价与禁忌，一个来源，一处维护。
   * - 不需要说明的组保持默认空实现，不必覆写。
   */
  system(): string {
    return "";
  }

  /** 本组全部动作。 */
  action_list(): readonly AnyCityAction[] {
    return this.actions;
  }

  /** 按组内裸名取动作；不存在时返回 null。 */
  action(action_name: string): AnyCityAction | null {
    const name = String(action_name || "").trim();
    if (!name) return null;
    return this.actions.find((item) => item.action === name) ?? null;
  }

  /** 把组内动作名展开为对模型可见的点号 id。 */
  action_ids(): string[] {
    return this.actions.map((item) => `${this.group}.${item.action}`);
  }
}
