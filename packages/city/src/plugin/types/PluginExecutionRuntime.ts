/** Plugin 在 Agent/Workspace 范围内的执行协议。 */

import type {
  PluginDefinition,
  PluginActionResult,
  PluginAvailability,
  PluginContext,
  PluginExecutionContext,
  PluginJsonValue as JsonValue,
  PluginReadView,
  PluginSnapshot,
  PluginView,
} from "@/plugin/index.js";
import type { SessionInteractionPort } from "@downcity/agent";
import type { SessionSystemBlock } from "@downcity/type/session";

/** 当前 Agent/Workspace 可用的只读 Plugin 调用面。 */
export interface AgentPluginRuntime {
  /** 判断 plugin 是否已注册。 */
  has(plugin_name: string): boolean;
  /** 读取单个 plugin 定义。 */
  get(plugin_name: string): PluginDefinition | null;
  /** 读取单个 plugin 注册快照。 */
  status(plugin_name: string): PluginSnapshot | null;
  /** 列出全部已注册 plugin 快照。 */
  snapshots(): PluginSnapshot[];
  /** 列出全部已注册 plugin。 */
  list(): PluginView[];
  /** 读取 plugin / action metadata。 */
  read(params: {
    /** Plugin 名称。 */
    plugin?: string;
    /** Action 名称。 */
    action?: string;
  }): PluginReadView | { plugins: PluginView[] };
  /** 检查指定 plugin 可用性。 */
  availability(plugin_name: string): Promise<PluginAvailability>;
  /** 运行指定 plugin action。 */
  run_action(params: {
    /** Plugin 名称。 */
    plugin: string;
    /** Action 名称。 */
    action: string;
    /** Action Payload（可选）。 */
    payload?: JsonValue;
    /** 当前 action 所属 Session Turn 的只读 Plugin 执行快照。 */
    execution_context?: PluginExecutionContext;
    /** 当前 Session 的 Interaction 端口；非 Session 调用时为空。 */
    interactions?: SessionInteractionPort;
  }): Promise<PluginActionResult<JsonValue>>;
  /** 读取当前生效的 plugin system blocks。 */
  system_blocks(
    execution_context?: PluginExecutionContext,
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
 * Plugin execution view 的只读调用能力。
 */
export interface AgentPluginExecutionView {
  /** 读取当前视图中的 plugin/action metadata。 */
  read(params: {
    /** Plugin 名称（可选）。 */
    plugin?: string;
    /** Action 名称（可选）。 */
    action?: string;
  }): PluginReadView | { plugins: PluginView[] };

  /** 检查当前视图中指定 Plugin 的可用性。 */
  availability(plugin_name: string): Promise<PluginAvailability>;

  /** 运行当前视图中捕获的 plugin action。 */
  run_action(params: {
    /** Plugin 名称。 */
    plugin: string;
    /** Action 名称。 */
    action: string;
    /** Action Payload（可选）。 */
    payload?: JsonValue;
    /** 当前 action 所属 Session Turn 的只读 Plugin 执行快照。 */
    execution_context?: PluginExecutionContext;
    /** 当前 Session 的 Interaction 端口；非 Session 调用时为空。 */
    interactions?: SessionInteractionPort;
  }): Promise<PluginActionResult<JsonValue>>;

  /** 解析当前视图中捕获的 plugin system blocks。 */
  system_blocks(
    execution_context?: PluginExecutionContext,
  ): Promise<SessionSystemBlock[]>;

  /** 在当前 execution snapshot 中运行已有 Plugin pipeline point。 */
  pipeline<T = JsonValue>(point_name: string, value: T): Promise<T>;

  /** 在当前 execution snapshot 中运行已有 Plugin guard point。 */
  guard<T = JsonValue>(point_name: string, value: T): Promise<void>;

  /** 在当前 execution snapshot 中运行已有 Plugin effect point。 */
  effect<T = JsonValue>(point_name: string, value: T): Promise<void>;

  /** 在当前 execution snapshot 中运行唯一的 Plugin resolve point。 */
  resolve<TInput = JsonValue, TOutput = JsonValue>(
    point_name: string,
    value: TInput,
  ): Promise<TOutput>;
}

/**
 * 单次 Session step 持有的 Plugin 执行 lease。
 */
export interface AgentPluginExecutionLease extends AgentPluginExecutionView {
  /**
   * 释放当前 step 对捕获 Plugin 实例的占用。
   *
   * 关键点（中文）
   * - 必须幂等，重复释放不会重复减少引用。
   * - 若 Plugin 已从 Registry 移除，最后一个 lease 释放时完成退休等待。
   */
  release(): Promise<void>;
}

/**
 * Session effective 配置持有的 Plugin 执行 runtime。
 */
export interface AgentPluginExecutionRuntime extends AgentPluginExecutionView {
  /**
   * 为当前 Session step 获取独立的 Plugin 执行 lease。
   *
   * 关键点（中文）
   * - lease 只捕获创建 runtime 时存在的 Plugin records。
   * - 已退休的 Plugin 不会进入新 lease。
   */
  acquire(): AgentPluginExecutionLease;
}

export type {
  PluginEffectHook,
  PluginGuardHook,
  PluginHooks,
  PluginPipelineHook,
  PluginResolveHook,
  PluginResolves,
} from "@/plugin/index.js";
