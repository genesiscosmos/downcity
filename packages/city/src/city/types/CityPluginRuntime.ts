/**
 * City Plugin 包内运行时类型。
 *
 * 这些类型只描述 City 唯一 Registry、Plugin 生命周期记录与 Agent 执行网关，
 * 不属于用户公开 API。
 */

import type { Agent, Logger, SessionHooks } from "@downcity/agent";
import type { RuntimeTool } from "@downcity/type";
import type { Embassy } from "@downcity/federation";
import type { CityRuntimeAccess } from "@/city/types/CityRuntimeAccess.js";
import type {
  CityPluginRegistration,
  PluginConfigAction,
  PluginDefinition,
  PluginHostAction,
  PluginLifecycleContext,
} from "@/plugin/index.js";
import type { CityPluginHost } from "@/city/types/CityPlugin.js";
import type { StorageProvider, WorkspaceRuntime } from "@/workspace/index.js";

/** City Plugin Runtime 创建参数。 */
export interface CityPluginRuntimeOptions {
  /** City 为 Plugin 私有数据提供的底层存储。 */
  readonly storage: StorageProvider;
  /** City 为 Plugin Context 提供的 Federation Embassy。 */
  readonly embassy?: Embassy;
  /** Plugin Runtime 所需的 City 内部事实源访问能力。 */
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
  /** Plugin 初始化与释放共享的 City 级稳定上下文。 */
  readonly lifecycle_context: PluginLifecycleContext;
  /** Sidebar/Mainview 业务 action。 */
  readonly host_actions: Map<string, PluginHostAction>;
  /** Plugin 唯一配置 action。 */
  readonly config_actions: Map<string, PluginConfigAction>;
  /** Plugin 初始化完成的唯一 Promise。 */
  ready: Promise<void>;
  /** 当前仍在执行的宿主管理 action 数量。 */
  active_host_calls: number;
  /** 存在宿主管理 action 时等待全部调用收口的 Promise。 */
  host_calls_idle?: Promise<void>;
  /** 最后一个宿主管理 action 收口时兑现等待 Promise。 */
  resolve_host_calls_idle?: () => void;
  /** Plugin 是否已经进入需要释放的生命周期。 */
  lifecycle_active: boolean;
  /** Plugin 当前可观察状态。 */
  state: "initializing" | "ready" | "error";
  /** Plugin 加入 City 的时间戳。 */
  readonly registered_at: number;
  /** Plugin 状态最近更新时间戳。 */
  updated_at: number;
  /** Plugin 最近一次初始化错误。 */
  last_error?: string;
}

/** City 绑定到一个 Agent 的无状态 Plugin 能力网关。 */
export interface CityAgentPluginBinding {
  /** 等待 City 当前已提交的 Plugin 生命周期操作完成。 */
  ensure_ready(): Promise<void>;
  /** 返回当前 Agent/Workspace 可用的模型 Tool。 */
  tools(workspace: WorkspaceRuntime, logger: Logger): Record<string, RuntimeTool>;
  /** 返回当前 Agent/Workspace 的 Session Hooks。 */
  hooks(workspace: WorkspaceRuntime, logger: Logger): SessionHooks;
  /** 订阅 City 唯一 Plugin Registry 的变化。 */
  subscribe(subscriber: (change: {
    /** Plugin 变化类型。 */
    readonly type: "add" | "remove";
    /** Plugin 稳定 ID。 */
    readonly plugin_id: string;
    /** 是否属于 Agent 绑定时已经提交、但仍在初始化的 Plugin。 */
    readonly initial: boolean;
  }) => void): () => void;
}
