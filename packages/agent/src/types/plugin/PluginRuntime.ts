/**
 * Plugin runtime 类型。
 *
 * 关键点（中文）
 * - 这里描述 Agent runtime 如何查看、调用、检查 plugin。
 * - setup/usage UI 协议与 action 输入适配不放在这里。
 */

import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { StructuredConfig } from "@/types/plugin/PluginConfig.js";
import type { JsonValue } from "@/types/common/Json.js";
import type { PluginActionResult } from "@/types/plugin/PluginAction.js";
import type { PluginActionExample } from "@/types/plugin/PluginAction.js";
import type { Plugin } from "@/types/plugin/PluginDefinition.js";
import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import type { PluginSnapshot } from "@/types/plugin/PluginState.js";
import type { SessionRunContext } from "@/types/executor/SessionRunContext.js";

/**
 * Plugin 概览视图。
 */
export interface PluginView {
  /** Plugin 稳定名称。 */
  name: string;
  /** Plugin 面向用户界面的展示标题。 */
  title: string;
  /** Plugin 面向人类的用途说明。 */
  description: string;
  /** Plugin Action 名称列表。 */
  actions: string[];
  /** Plugin pipeline 点名称列表。 */
  pipelines: string[];
  /** Plugin guard 点名称列表。 */
  guards: string[];
  /** Plugin effect 点名称列表。 */
  effects: string[];
  /** Plugin resolve 点名称列表。 */
  resolves: string[];
  /** 是否声明了 system 注入。 */
  has_system: boolean;
  /** 是否声明了 availability 检查。 */
  has_availability: boolean;
}

/**
 * Plugin Action 读取视图。
 */
export interface PluginActionReadView {
  /** Action 名称。 */
  name: string;
  /** Action 用途说明。 */
  description: string;
  /** 是否声明输入 schema。 */
  has_input_schema: boolean;
  /** JSON Schema 形式的输入说明。 */
  input_schema?: JsonValue;
  /** Action 调用示例。 */
  examples?: PluginActionExample[];
  /** 是否声明 CLI command。 */
  has_command: boolean;
  /** 是否声明 HTTP API。 */
  has_api: boolean;
}

/**
 * Plugin 读取视图。
 */
export interface PluginReadView {
  /** Plugin 稳定名称。 */
  name: string;
  /** Plugin 展示标题。 */
  title: string;
  /** Plugin 用途说明。 */
  description: string;
  /** Action 列表或指定 action。 */
  actions: PluginActionReadView[];
}

/**
 * Plugin 可用性结果。
 */
export interface PluginAvailability {
  /** Plugin 是否已注册。 */
  enabled: boolean;
  /** Plugin 当前环境是否可用。 */
  available: boolean;
  /** 不可用原因列表。 */
  reasons: string[];
}

/**
 * 当前 Agent 可用的 plugin 调用面。
 */
export interface AgentPlugins {
  /** 注册或替换一个 plugin。 */
  register(plugin: Plugin): Promise<PluginSnapshot>;
  /**
   * 从 configured registry 卸载一个 plugin。
   *
   * 关键点（中文）
   * - 返回值表示 configured registry 是否发生删除。
   * - 活跃 Session step 仍可使用已捕获的 execution lease，lifecycle.stop 在 lease 释放后执行。
   */
  unregister(plugin_name: string): Promise<boolean>;
  /** 启动全部已挂载 plugin lifecycle。 */
  start_all(): Promise<PluginSnapshot[]>;
  /** 卸载全部 plugin，并等待所有 execution lease 释放后的 lifecycle.stop 完成。 */
  unregister_all(): Promise<void>;
  /** 判断 plugin 是否已注册。 */
  has(plugin_name: string): boolean;
  /** 读取单个 plugin 定义。 */
  get(plugin_name: string): Plugin | null;
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
    /** 当前 action 所属的显式 Session run 上下文。 */
    run_context?: SessionRunContext;
  }): Promise<PluginActionResult<JsonValue>>;
  /** 读取当前生效的 plugin system blocks。 */
  system_blocks(
    run_context?: SessionRunContext,
  ): Promise<AgentSessionSystemBlock[]>;
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

  /** 运行当前视图中捕获的 plugin action。 */
  run_action(params: {
    /** Plugin 名称。 */
    plugin: string;
    /** Action 名称。 */
    action: string;
    /** Action Payload（可选）。 */
    payload?: JsonValue;
    /** 当前 action 所属的显式 Session run 上下文。 */
    run_context?: SessionRunContext;
  }): Promise<PluginActionResult<JsonValue>>;

  /** 解析当前视图中捕获的 plugin system blocks。 */
  system_blocks(
    run_context?: SessionRunContext,
  ): Promise<AgentSessionSystemBlock[]>;
}

/**
 * 单次 Session step 持有的 Plugin 执行 lease。
 */
export interface AgentPluginExecutionLease extends AgentPluginExecutionView {
  /**
   * 释放当前 step 对捕获 Plugin lifecycle 的占用。
   *
   * 关键点（中文）
   * - 必须幂等，重复释放不会重复停止 lifecycle。
   * - 若 Plugin 已从 configured registry 移除，最后一个 lease 释放时完成延迟 stop。
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
   * - 已退休或 lifecycle 未就绪的 Plugin 不会进入新 lease。
   */
  acquire(): AgentPluginExecutionLease;
}

/**
 * Plugin 配置定义。
 */
export interface PluginConfigDefinition<T extends StructuredConfig = StructuredConfig> {
  /** Plugin 稳定名称。 */
  plugin: string;
  /** 配置作用域。 */
  scope: "global" | "project";
  /** 默认配置值。 */
  default_value: T;
}

/**
 * Plugin pipeline 处理器。
 */
export type PluginPipelineHook<
  TValue extends JsonValue = JsonValue,
> = (params: {
  /** 当前执行上下文。 */
  context: PluginContext;
  /** 当前值。 */
  value: TValue;
  /** 当前插件名称。 */
  plugin: string;
}) => Promise<TValue> | TValue;

/**
 * Plugin guard 处理器。
 *
 * 关键点（中文）
 * - 不返回结果；若需阻断流程，直接抛错。
 */
export type PluginGuardHook<TValue extends JsonValue = JsonValue> = (params: {
  /** 当前执行上下文。 */
  context: PluginContext;
  /** 当前值。 */
  value: TValue;
  /** 当前插件名称。 */
  plugin: string;
}) => Promise<void> | void;

/**
 * Plugin effect 处理器。
 */
export type PluginEffectHook<TValue extends JsonValue = JsonValue> = (params: {
  /** 当前执行上下文。 */
  context: PluginContext;
  /** 当前值。 */
  value: TValue;
  /** 当前插件名称。 */
  plugin: string;
}) => Promise<void> | void;

/**
 * Plugin resolve 处理器。
 */
export type PluginResolveHook<
  TInput extends JsonValue = JsonValue,
  TOutput extends JsonValue = JsonValue,
> = (params: {
  /** 当前执行上下文。 */
  context: PluginContext;
  /** 当前输入值。 */
  value: TInput;
  /** 当前插件名称。 */
  plugin: string;
}) => Promise<TOutput> | TOutput;

/**
 * Plugin Hook 定义集合。
 */
export interface PluginHooks {
  /** pipeline 点映射。 */
  pipeline?: Record<string, PluginPipelineHook<JsonValue>[]>;
  /** guard 点映射。 */
  guard?: Record<string, PluginGuardHook<JsonValue>[]>;
  /** effect 点映射。 */
  effect?: Record<string, PluginEffectHook<JsonValue>[]>;
}

/**
 * Plugin resolve 点集合。
 */
export type PluginResolves = {
  [point_name: string]: PluginResolveHook<JsonValue, JsonValue>;
};
