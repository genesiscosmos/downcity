/**
 * Power 在 Agent/Workspace 范围内的执行协议。
 *
 * 关键点（中文）
 * - Agent 不认识 Registry：它拿到的工具与 Hook 已经是编译产物。
 * - 这份接口只服务 Power 之间的嵌套调用与 Context 投影，不进入 Agent。
 * - 不存在 execution lease：调用是一次性的，不持有实例引用计数。
 */

import type {
  PowerActionResult,
  PowerAvailability,
  PowerDefinition,
  PowerExecutionContext,
  PowerJsonValue as JsonValue,
  PowerReadView,
  PowerSnapshot,
  PowerView,
} from "@/power/index.js";
import type { SessionInteractionPort } from "@downcity/type";

/** 当前 Agent/Workspace 可用的 Power 调用面。 */
export interface AgentPowerRuntime {
  /** 判断 power 是否已注册。 */
  has(power_name: string): boolean;
  /** 读取单个 power 定义。 */
  get(power_name: string): PowerDefinition | null;
  /** 读取单个 power 注册快照。 */
  status(power_name: string): PowerSnapshot | null;
  /** 列出全部已注册 power 快照。 */
  snapshots(): PowerSnapshot[];
  /** 列出全部已注册 power。 */
  list(): PowerView[];
  /** 读取 power / action metadata。 */
  read(params: {
    /** Power 名称。 */
    power?: string;
    /** Action 名称。 */
    action?: string;
  }): PowerReadView | { powers: PowerView[] };
  /** 检查指定 power 可用性。 */
  availability(power_name: string): Promise<PowerAvailability>;
  /** 运行指定 power action。 */
  run_action(params: {
    /** Power 名称。 */
    power: string;
    /** Action 名称。 */
    action: string;
    /** Action Payload（可选）。 */
    payload?: JsonValue;
    /** 当前 action 所属 Session Turn 的只读执行快照。 */
    execution_context?: PowerExecutionContext;
    /**
     * 当前入口提供的交互端口。
     *
     * 关键点（中文）：Session 入口传入自身端口；非 Session 入口省略，由流水线注入拒绝式实现。
     */
    interactions?: SessionInteractionPort;
  }): Promise<PowerActionResult<JsonValue>>;
  /** 运行 pipeline 点，按顺序链式变换值。 */
  pipeline<T = JsonValue>(point_name: string, value: T): Promise<T>;
  /** 运行 guard 点；任一处理器抛错即终止。 */
  guard<T = JsonValue>(point_name: string, value: T): Promise<void>;
  /** 运行 effect 点；只执行副作用。 */
  effect<T = JsonValue>(point_name: string, value: T): Promise<void>;
  /** 运行 resolve 点；要求存在且仅存在一个处理器。 */
  resolve<TInput = JsonValue, TOutput = JsonValue>(
    point_name: string,
    value: TInput,
  ): Promise<TOutput>;
}

export type {
  PowerEffectHook,
  PowerGuardHook,
  PowerHooks,
  PowerPipelineHook,
  PowerResolveHook,
  PowerResolves,
} from "@/power/index.js";
