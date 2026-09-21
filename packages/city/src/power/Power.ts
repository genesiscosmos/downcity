/**
 * Power 基类。
 *
 * 关键点（中文）
 * - Power 自己知道如何编译成模型侧工具与检查点处理器；Registry 只负责集合与查询。
 * - 编译实现只有一份，在 `tool/PowerTools` 与 `core/CompilePowerHooks`；
 *   本基类只把它们暴露为实例方法，让 Power 作者能以面向对象方式使用。
 * - 一个 City 中每个 Power ID 只存在一个实例，由容器持有生命周期。
 * - 可执行部件声明为可选方法，子类既可用方法覆写，也可用属性赋值。
 */

import type { AgentTool, ToolHookSet } from "@downcity/type";
import type { PowerRuntimeHost } from "./types/PowerCallSite.js";
import type {
  PowerActions,
  PowerAvailability,
  PowerDefinition,
  PowerHooks,
  PowerHttpDefinition,
  PowerResolves,
} from "./types/PowerRuntime.js";
import type { PowerContext } from "./types/PowerContext.js";
import type { PowerLifecycleContext } from "./types/PowerHost.js";
import type { StepSnapshot } from "./types/StepSnapshot.js";
import { compile_power_hooks } from "./core/CompilePowerHooks.js";
import { create_power_tool } from "./tool/PowerTools.js";

/**
 * City 持有的 Power 基类。
 *
 * 关键点（中文）
 * - 子类只需声明身份、动作与 hooks；编译由基类统一完成。
 * - 无动作的 Power 不产生空壳工具，`compile_tool` 返回 null。
 */
export abstract class Power implements PowerDefinition {
  /** Power 稳定 ID，同时是模型侧工具名。 */
  abstract readonly name: string;

  /** Power 用户可见标题。 */
  readonly title: string = "";

  /** Power 用途说明。 */
  readonly description: string = "";

  /** Power Action 集合。 */
  readonly actions: PowerActions = {};

  /** Power 原始 Hook 声明；由基类编译为检查点处理器。 */
  readonly hooks?: PowerHooks;

  /** Power Resolve 点集合。 */
  readonly resolves?: PowerResolves;

  /** Power 的可选 HTTP 路由声明。 */
  readonly http?: PowerHttpDefinition;

  /** 构建当前执行范围的 system 文本。 */
  system?(context: PowerContext, snapshot: StepSnapshot): string | Promise<string>;

  /** Power 加入 City 时初始化自身长期资源。 */
  initialize?(context: PowerLifecycleContext): void | Promise<void>;

  /** Power 离开 City 时释放自身长期资源。 */
  dispose?(context: PowerLifecycleContext): void | Promise<void>;

  /** 检查当前上下文的可用性。 */
  availability?(context: PowerContext): PowerAvailability | Promise<PowerAvailability>;

  /**
   * 编译为模型侧工具。
   *
   * 关键点（中文）：工具闭包持有本实例与容器端口，执行时不再回到 Registry。
   * 没有动作的 Power 返回 null，不产生空壳工具。
   */
  compile_tool(host: PowerRuntimeHost): AgentTool | null {
    return create_power_tool({ power: this, host });
  }

  /**
   * 编译为检查点处理器集合。
   *
   * 关键点（中文）：`system()` 并入 `system_context` 检查点，因此 Power 只有
   * 一个位置写 system 内容，不需要判断「静态说明写 system() 还是 pipeline」。
   */
  compile_hooks(host: PowerRuntimeHost): ToolHookSet {
    return compile_power_hooks({ definitions: [this], host });
  }
}
