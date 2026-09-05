/**
 * City Plugin 所有权与运行时协议。
 *
 * 一个 City 中每个 Plugin ID 只对应一个实例。City 负责实例的启动、作用域连接、
 * 执行快照和停止；所有已注册 Agent 自动获得 City 的全部 Plugin。
 */

import type { Hono } from "hono";
import type { Agent } from "@downcity/agent";
import type {
  CityPluginRegistration,
  PluginDefinition,
  PluginConfigAction,
  PluginContext,
  PluginHostAction,
  PluginJsonObject,
  PluginJsonValue,
  PluginNotificationPublisher,
  PluginProfileConfigStore,
  PluginSnapshot,
  PluginStartContext,
} from "@/plugin/index.js";
import type { Logger, SessionHooks } from "@downcity/agent";
import type { PluginRegistry } from "@/plugin/core/PluginRegistry.js";
import type { AgentPluginRuntime } from "@/plugin/types/PluginExecutionRuntime.js";

/** City 构造期接受的单个 Plugin 输入。 */
export type CityPluginInput = PluginDefinition | CityPluginRegistration;

/** City 构造期接受的 Plugin 集合。 */
export type CityPluginCollection =
  | readonly CityPluginInput[]
  | Readonly<Record<string, CityPluginInput>>;

/** City 为 Agent 投影的 Plugin 能力。 */
export interface CityAgentPlugins {
  /** 等待当前 City Plugin 完成初始化。 */
  ensure_ready(): Promise<void>;

  /** 建立一个 Agent/Workspace Plugin Context。 */
  connect_workspace(
    workspace: import("@/workspace/index.js").WorkspaceRuntime,
    logger: Logger,
  ): Promise<void>;

  /** 释放一个 Agent/Workspace Plugin Context。 */
  disconnect_workspace(workspace_id: string): Promise<void>;

  /** 返回当前 Agent/Workspace 可用的模型 Tool。 */
  tools(
    workspace: import("@/workspace/index.js").WorkspaceRuntime,
    logger: Logger,
  ): Record<string, import("@downcity/type").RuntimeTool>;

  /** 返回当前 Agent/Workspace 的 Session Hooks。 */
  hooks(
    workspace: import("@/workspace/index.js").WorkspaceRuntime,
    logger: Logger,
  ): SessionHooks;

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

/** City 对外暴露的 Plugin 集合。 */
export interface CityPlugins {
  /**
   * 向 City 添加唯一 Plugin 实例或带 UI 元数据的注册项，并等待启动及已有作用域连接。
   */
  add(input: CityPluginInput): Promise<void>;

  /** 从 City 移除 Plugin，并等待正在执行的 Hook/Action 收口。 */
  remove(plugin_id: string): Promise<boolean>;

  /** 返回 City 当前全部 Plugin 状态快照。 */
  snapshots(): PluginSnapshot[];

  /** 获取 City 当前持有的唯一 Plugin 实例。 */
  get(plugin_id: string): PluginDefinition | null;

  /** 返回指定 Agent/Workspace 的 Plugin 直接调用面。 */
  scope(input: {
    /** 当前调用所属 Agent 的稳定标识。 */
    readonly agent_id: string;
    /** 当前调用所属 Workspace 的稳定标识。 */
    readonly workspace_id: string;
  }): AgentPluginRuntime;

  /** 向指定应用注册一个 Agent/Workspace 下的 Plugin HTTP 路由。 */
  register_http_routes(
    app: Hono,
    input: {
      /** 当前请求所属 Agent 的稳定标识。 */
      readonly agent_id: string;
      /** 当前请求所属 Workspace 的稳定标识。 */
      readonly workspace_id: string;
    },
  ): void;

  /** 调用 Plugin 在 start 阶段注册的宿主管理 action。 */
  invoke(plugin_id: string, action_id: string, input?: PluginJsonValue): Promise<PluginJsonValue>;

  /** 在指定配置 Profile 上调用 Plugin 注册的配置 action。 */
  invoke_config(
    plugin_id: string,
    profile_id: string,
    action_id: string,
    input?: PluginJsonValue,
  ): Promise<PluginJsonValue>;
}

/** City Plugin 启动阶段需要宿主提供的平台能力。 */
export interface CityPluginHost {
  /** 解析当前 Agent 使用的 Plugin 配置；未配置时返回空对象。 */
  runtime_config?(plugin_id: string, agent_id: string): PluginJsonObject;
  /** 返回指定 Plugin 配置 Profile 的存储端口。 */
  profile_config(plugin_id: string, profile_id: string): PluginProfileConfigStore;
  /** 返回绑定当前 Plugin 身份的通知发布端口。 */
  notifications(plugin_id: string, agent_id?: string): PluginNotificationPublisher;
  /** 使用系统默认应用打开 HTTP(S) URL。 */
  open_external?(url: string): Promise<void>;
  /** 在平台文件管理器中显示绝对路径。 */
  show_item_in_folder?(path: string): Promise<void>;
  /** 写入平台剪贴板文本。 */
  write_clipboard_text?(text: string): Promise<void>;
}

/** City Plugin Runtime 创建参数。 */
export interface CityPluginRuntimeOptions {
  /** 当前 City 实例。 */
  readonly city: import("@/city/runtime/City.js").City;
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
  /** 初始与动态 Plugin 装配串行链。 */
  ready: Promise<void>;
  /** 动态 Plugin 修改串行链。 */
  mutation_chain: Promise<void>;
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
