/**
 * City 领域 Power 基类：把动作组装配为一个模型可见工具。
 *
 * 关键点（中文）
 * - 继承 `Power` 基类，与其它 power 同构；`name` 即模型侧工具名。
 * - 一个领域 power 持有若干动作组，动作 id 仍由组名拼成 `${group}.${action}`，
 *   因此领域拆分不会改变模型侧已有的动作 id。
 * - 动作直接使用调用绑定的 `PowerContext`，身份、City 目录与私有存储只有一份来源。
 * - 动作 id 在构造期一次性展开，注册后不再变化。
 */

import type {
  PowerAction,
  PowerActions,
  PowerJsonObject,
  PowerJsonValue,
} from "@/power/index.js";
import { Power } from "@/power/index.js";
import { CityActionError } from "@/city/power/builtin/CityAction.js";
import type { AnyCityAction } from "@/city/power/builtin/CityAction.js";
import type { CityActionGroup } from "@/city/power/builtin/CityActionGroup.js";

/**
 * City 自有的领域 power。
 *
 * 关键点（中文）：子类只声明身份与动作组，动作展开与 system 合并由基类完成。
 */
export abstract class CityGroupPower extends Power {
  /** Power 稳定名称，即模型侧工具名。 */
  abstract readonly name: string;

  /** Power 用户可见标题。 */
  abstract readonly title: string;

  /** Power 用途说明。 */
  abstract readonly description: string;

  /** 当前 power 的动作组集合，顺序即模型侧索引顺序。 */
  private readonly groups: readonly CityActionGroup[];

  /** 构造期一次性展开的动作集合，键为点号 action id。 */
  readonly actions: PowerActions;

  constructor(groups: readonly CityActionGroup[]) {
    super();
    this.groups = groups;
    const actions: PowerActions = {};
    for (const group of this.groups) {
      for (const action of group.action_list()) {
        const action_id = `${group.group}.${action.action}`;
        actions[action_id] = to_power_action({
          action_id,
          action,
        });
      }
    }
    this.actions = actions;
  }

  /** 合并本 power 全部动作组的说明文本。 */
  system(): string {
    return this.groups
      .map((group) => String(group.system() || "").trim())
      .filter(Boolean)
      .join("\n\n");
  }
}

/** 把一个组内动作适配为通用 `PowerAction`。 */
function to_power_action(input: {
  /** 对模型可见的点号动作 id。 */
  readonly action_id: string;
  /** 组内动作本体。 */
  readonly action: AnyCityAction;
}): PowerAction {
  const json_schema = input.action.args_schema
    ? to_json_schema(input.action.args_schema)
    : null;
  return {
    description: input.action.description,
    returns: input.action.returns,
    access: input.action.access,
    ...(input.action.args_schema
      ? {
          input_schema: {
            zod: input.action.args_schema,
            ...(json_schema ? { json_schema } : {}),
          },
        }
      : {}),
    async execute(params) {
      try {
        const data = await input.action.execute(params.input ?? {}, params.context, input.action_id);
        return {
          success: true,
          data: (data === undefined ? null : data) as PowerJsonValue,
          message: `${input.action_id} completed`,
        };
      } catch (error) {
        if (error instanceof CityActionError) {
          return {
            success: false,
            error: error.message,
            message: error.message,
            ...(error.detail ? { data: error.detail as PowerJsonValue } : {}),
          };
        }
        return {
          success: false,
          error: String(error),
          message: String(error),
        };
      }
    },
  };
}

/** 尽力把 Zod schema 转为 JSON Schema；失败时返回 null。 */
function to_json_schema(schema: unknown): PowerJsonObject | null {
  const candidate = schema as { toJSONSchema?: () => unknown } | null;
  if (!candidate || typeof candidate.toJSONSchema !== "function") return null;
  try {
    const value = candidate.toJSONSchema();
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as PowerJsonObject;
  } catch {
    return null;
  }
}
