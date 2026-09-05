/**
 * City Plugin 包内运行时类型。
 *
 * 这些类型描述 City 内部的生命周期记录与 Agent 绑定投影，不属于用户公开 API。
 */

import type { Agent, Logger, SessionHooks } from "@downcity/agent";
import type { RuntimeTool } from "@downcity/type";
import type { Embassy } from "@downcity/federation";
import type { CityRuntimeAccess } from "@/city/types/CityRuntimeAccess.js";
import type { PluginRegistry } from "@/plugin/core/PluginRegistry.js";
import type {
  CityPluginRegistration,
  PluginConfigAction,
  PluginContext,
  PluginDefinition,
  PluginHostAction,
  PluginStartContext,
} from "@/plugin/index.js";
import type { CityPluginHost } from "@/city/types/CityPlugin.js";
import type { StorageProvider, WorkspaceRuntime } from "@/workspace/index.js";

/** City Plugin Runtime 创建参数。 */
export interface CityPluginRuntimeOptions {
  /** City 为 Plugin 私有数据提供的底层存储。 */
  readonly storage: StorageProvider;
  /** City 为 Plugin Context 提供的 Federation Embassy。 */
  readonly embassy?: Embassy;
  /** Plugin Runtime 所需的 City 内部作用域访问能力。 */
  readonly runtime_access: Pick<
    CityRuntimeAccess,
    "list_agents" | "list_workspaces" | "require_workspace" | "enter_workspace"
  >;
  /** City 可选的平台宿主能力。 */
  readonly host?: CityPluginHost;
}

/** City 内唯一 Plugin 实例的生命周期记录。 */
export interface CityPluginRecord {
  /** Plugin 稳定 ID。 */
  readonly plugin_id: string;
  /** Plugin 注册元数据。 */
  readonly registration: CityPluginRegistration;
  /** City 持有的唯一 Plugin 实例。 */
  readonly plugin: PluginDefinition;
  /** Plugin 私有日志器。 */
  readonly logger: Logger;
  /** Plugin 全局生命周期与宿主动作使用的稳定上下文。 */
  readonly start_context: PluginStartContext;
  /** Sidebar/Mainview 业务 action。 */
  readonly host_actions: Map<string, PluginHostAction>;
  /** Profile config action。 */
  readonly config_actions: Map<string, PluginConfigAction>;
  /** Plugin 启动完成的唯一 Promise。 */
  ready: Promise<void>;
  /** Plugin start 是否已经成功。 */
  started: boolean;
  /** Plugin 当前可观察状态。 */
  state: "initializing" | "ready" | "error";
  /** Plugin 加入 City 的时间戳。 */
  readonly registered_at: number;
  /** Plugin 状态最近更新时间戳。 */
  updated_at: number;
  /** Plugin 最近一次启动错误。 */
  last_error?: string;
}

/** City 内一个 Agent 的 Plugin 执行索引。 */
export interface CityAgentPluginRuntimeRecord {
  /** 当前 Agent 实例。 */
  readonly agent: Agent;
  /** 当前 Agent 的执行 Registry。 */
  readonly registry: PluginRegistry;
  /** 初始与动态 Plugin 装配完成后的稳定屏障。 */
  ready: Promise<void>;
  /** 动态 Plugin 修改串行链。 */
  mutation_chain: Promise<void>;
}

/** City 绑定到一个 Agent 的 Plugin 能力投影。 */
export interface CityAgentPluginBinding {
  /** 等待当前 City Plugin 集合进入稳定状态。 */
  ensure_ready(): Promise<void>;
  /** 建立一个 Agent/Workspace Plugin Context。 */
  connect_workspace(workspace: WorkspaceRuntime, logger: Logger): Promise<void>;
  /** 释放一个 Agent/Workspace Plugin Context。 */
  disconnect_workspace(workspace_id: string): Promise<void>;
  /** 返回当前 Agent/Workspace 可用的模型 Tool。 */
  tools(workspace: WorkspaceRuntime, logger: Logger): Record<string, RuntimeTool>;
  /** 返回当前 Agent/Workspace 的 Session Hooks。 */
  hooks(workspace: WorkspaceRuntime, logger: Logger): SessionHooks;
  /** 订阅 City Plugin 集合变化。 */
  subscribe(subscriber: (change: {
    /** Plugin 变化类型。 */
    readonly type: "add" | "remove";
    /** Plugin 稳定 ID。 */
    readonly plugin_id: string;
    /** 是否属于 Agent 加入 City 时的初始装配。 */
    readonly initial: boolean;
  }) => void): () => void;
}

/** 一个 Agent/Workspace 的 Plugin Context 集合。 */
export interface CityPluginWorkspaceContext {
  /** Registry 默认使用的 Workspace Context。 */
  readonly context: PluginContext;
  /** 各 Plugin 私有存储对应的 Context。 */
  readonly contexts_by_plugin: Map<string, PluginContext>;
  /** Context 创建时捕获的 Plugin 记录，保证移除竞态下仍可执行 disconnect。 */
  readonly records_by_plugin: Map<string, CityPluginRecord>;
  /** 各 Plugin 作用域唯一的 connect 流程。 */
  readonly connection_promises: Map<string, Promise<void>>;
  /** 仅在当前工厂仍生效时解除 Registry Context。 */
  readonly release_registry_context: () => void;
}
