/**
 * Plugin runtime 类型。
 *
 * 关键点（中文）
 * - 这里描述 Agent runtime 如何查看、调用、检查 plugin。
 * - setup/usage UI 协议与 action 输入适配不放在这里。
 */

import type {
  Plugin,
  PluginActionExample,
  PluginActionResult,
  PluginContext,
  PluginExecutionContext,
  PluginJsonValue as JsonValue,
  PluginSnapshot,
} from "@/plugin/index.js";
import type { SessionInteractionPort } from "@downcity/agent";
import type { SessionSystemBlock } from "@downcity/type/session";

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

/** 当前 Agent/Workspace 可用的只读 Plugin 调用面。 */
export interface AgentPluginRuntime {
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

/** City 内部 Registry 的变更能力；不会投影给 Workspace 或 PluginContext。 */
export interface AgentPlugins extends AgentPluginRuntime {
  /** 注册或替换一个 Plugin 执行投影。 */
  register(plugin: Plugin): Promise<PluginSnapshot>;
  /** 立即移除新执行可见性，并等待已有 lease 在内部退休。 */
  unregister(plugin_name: string): Promise<boolean>;
  /** 启动 Registry 构造期挂载的全部 Plugin。 */
  start_all(): Promise<PluginSnapshot[]>;
  /** 移除全部 Plugin，并等待已有 execution lease 释放。 */
  unregister_all(): Promise<void>;
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

  /** 在当前 execution snapshot 中运行已有 Plugin effect point。 */
  effect<T = JsonValue>(point_name: string, value: T): Promise<void>;
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

export type {
  PluginEffectHook,
  PluginGuardHook,
  PluginHooks,
  PluginPipelineHook,
  PluginResolveHook,
  PluginResolves,
} from "@/plugin/index.js";
