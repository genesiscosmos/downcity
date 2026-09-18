/** Power 在 Agent/Workspace 范围内的执行协议。 */

import type {
  PowerDefinition,
  PowerActionResult,
  PowerAvailability,
  PowerContext,
  PowerExecutionContext,
  PowerJsonValue as JsonValue,
  PowerReadView,
  PowerSnapshot,
  PowerView,
} from "@/power/index.js";
import type { SessionInteractionPort } from "@downcity/agent";
import type { SessionSystemBlock } from "@downcity/type/session";

/** 当前 Agent/Workspace 可用的只读 Power 调用面。 */
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
    /** 当前 action 所属 Session Turn 的只读 Power 执行快照。 */
    execution_context?: PowerExecutionContext;
    /** 当前 Session 的 Interaction 端口；非 Session 调用时为空。 */
    interactions?: SessionInteractionPort;
  }): Promise<PowerActionResult<JsonValue>>;
  /** 读取当前生效的 power system blocks。 */
  system_blocks(
    execution_context?: PowerExecutionContext,
  ): Promise<SessionSystemBlock[]>;
  /** 运行 pipeline 点，按顺序链式变换值。 */
  pipeline<T = JsonValue>(point_name: string, value: T): Promise<T>;
  /** 运行 guard 点；任一插件抛错即终止。 */
  guard<T = JsonValue>(point_name: string, value: T): Promise<void>;
  /** 运行 effect 点；只执行副作用。 */
  effect<T = JsonValue>(point_name: string, value: T): Promise<void>;
  /** 运行 resolve 点；要求存在且仅存在一个处理器。 */
  resolve<TInput = JsonValue, TOutput = JsonValue>(
    point_name: string,
    value: TInput,
  ): Promise<TOutput>;

}

/**
 * Power execution view 的只读调用能力。
 */
export interface AgentPowerExecutionView {
  /** 读取当前视图中的 power/action metadata。 */
  read(params: {
    /** Power 名称（可选）。 */
    power?: string;
    /** Action 名称（可选）。 */
    action?: string;
  }): PowerReadView | { powers: PowerView[] };

  /** 检查当前视图中指定 Power 的可用性。 */
  availability(power_name: string): Promise<PowerAvailability>;

  /** 运行当前视图中捕获的 power action。 */
  run_action(params: {
    /** Power 名称。 */
    power: string;
    /** Action 名称。 */
    action: string;
    /** Action Payload（可选）。 */
    payload?: JsonValue;
    /** 当前 action 所属 Session Turn 的只读 Power 执行快照。 */
    execution_context?: PowerExecutionContext;
    /** 当前 Session 的 Interaction 端口；非 Session 调用时为空。 */
    interactions?: SessionInteractionPort;
  }): Promise<PowerActionResult<JsonValue>>;

  /** 解析当前视图中捕获的 power system blocks。 */
  system_blocks(
    execution_context?: PowerExecutionContext,
  ): Promise<SessionSystemBlock[]>;

  /** 在当前 execution snapshot 中运行已有 Power pipeline point。 */
  pipeline<T = JsonValue>(point_name: string, value: T): Promise<T>;

  /** 在当前 execution snapshot 中运行已有 Power guard point。 */
  guard<T = JsonValue>(point_name: string, value: T): Promise<void>;

  /** 在当前 execution snapshot 中运行已有 Power effect point。 */
  effect<T = JsonValue>(point_name: string, value: T): Promise<void>;

  /** 在当前 execution snapshot 中运行唯一的 Power resolve point。 */
  resolve<TInput = JsonValue, TOutput = JsonValue>(
    point_name: string,
    value: TInput,
  ): Promise<TOutput>;
}

/**
 * 单次 Session step 持有的 Power 执行 lease。
 */
export interface AgentPowerExecutionLease extends AgentPowerExecutionView {
  /**
   * 释放当前 step 对捕获 Power 实例的占用。
   *
   * 关键点（中文）
   * - 必须幂等，重复释放不会重复减少引用。
   * - 若 Power 已从 Registry 移除，最后一个 lease 释放时完成退休等待。
   */
  release(): Promise<void>;
}

/**
 * Session effective 配置持有的 Power 执行 runtime。
 */
export interface AgentPowerExecutionRuntime extends AgentPowerExecutionView {
  /**
   * 为当前 Session step 获取独立的 Power 执行 lease。
   *
   * 关键点（中文）
   * - lease 只捕获创建 runtime 时存在的 Power records。
   * - 已退休的 Power 不会进入新 lease。
   */
  acquire(): AgentPowerExecutionLease;
}

export type {
  PowerEffectHook,
  PowerGuardHook,
  PowerHooks,
  PowerPipelineHook,
  PowerResolveHook,
  PowerResolves,
} from "@/power/index.js";
