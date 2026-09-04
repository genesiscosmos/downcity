/**
 * City Plugin 所有权、共享实例与 Agent 执行绑定协议。
 *
 * City 以 `(plugin_id, profile_id)` 为稳定键持有唯一 Plugin 实例及其生命周期；
 * Agent 只声明绑定，Session 只接收中性的扩展执行端口。
 */

import type {
  CityPluginRegistration,
  CityPluginModule,
  Plugin,
  PluginJsonValue,
  PluginMainAction,
  PluginConfigMainAction,
  PluginMainContext,
  PluginNotificationPublisher,
  PluginProfile,
  PluginProfileConfigStore,
  PluginSnapshot,
} from "@/plugin/index.js";
import type { Agent } from "@downcity/agent";
import type { AgentHostExtensions, Logger } from "@downcity/agent/host";
import type { PluginRegistry } from "@/plugin/core/PluginRegistry.js";
import type { AgentPluginRuntime } from "@/types/plugin/PluginRuntime.js";
import type { Hono } from "hono";

/** Agent 加入 City 时声明的一个 Plugin/Profile 绑定。 */
export interface CityAgentPluginBinding {
  /** City catalog 中已登记的 Plugin 稳定 ID。 */
  readonly plugin_id: string;
  /** 当前绑定选择的 Profile；无配置 Plugin 省略时使用 default。 */
  readonly profile?: PluginProfile;
}

/** Agent 加入 City 时声明的全部 Plugin 绑定。 */
export interface CityAgentPluginOptions {
  /** Plugin/Profile 绑定；同一 Agent 内 Plugin ID 必须唯一。 */
  readonly plugins?: readonly CityAgentPluginBinding[];
}

/** City 向单个 Agent 运行时投影的扩展能力。 */
export type AgentCityExtensionBinding = AgentHostExtensions;

/** City 为一个 Agent/Workspace 投影的 Plugin 执行作用域。 */
export type CityPluginScope = AgentPluginRuntime;

/** City 对外暴露的 Plugin 绑定入口。 */
export interface CityPlugins {
  /** 向 City catalog 登记一个 Plugin；相同 ID 只能对应同一模块。 */
  provide(registration: CityPluginRegistration): void;
  /** 为指定 Agent 绑定或替换一个 Plugin/Profile。 */
  register(agent_id: string, binding: CityAgentPluginBinding): Promise<PluginSnapshot>;
  /** 从指定 Agent 解绑 Plugin，并等待活跃 execution lease 释放。 */
  unregister(agent_id: string, plugin_id: string): Promise<boolean>;
  /** 读取一个 Agent 当前绑定的 Plugin 快照。 */
  snapshots(agent_id: string): PluginSnapshot[];
  /** 获取指定 Agent 当前绑定的共享 Plugin 实例。 */
  get(agent_id: string, plugin_id: string): Plugin | null;
  /** 返回指定 Agent/Workspace 的直接 Plugin 调用作用域。 */
  scope(input: {
    /** 当前 Plugin 调用所属的 Agent 稳定标识。 */
    readonly agent_id: string;
    /** 当前 Plugin 调用所属的 Workspace 稳定标识。 */
    readonly workspace_id: string;
  }): CityPluginScope;
  /** 向指定应用注册一个 Agent/Workspace 下的 Plugin HTTP 路由。 */
  register_http_routes(
    app: Hono,
    input: {
      /** 当前 Plugin HTTP 请求所属的 Agent 稳定标识。 */
      readonly agent_id: string;
      /** 当前 Plugin HTTP 请求所属的 Workspace 稳定标识。 */
      readonly workspace_id: string;
    },
  ): void;
  /** 调用 Plugin main 注册的业务 action。 */
  invoke(plugin_id: string, action_id: string, input?: PluginJsonValue): Promise<PluginJsonValue>;
  /** 在指定 Profile 配置范围调用 Plugin main config action。 */
  invoke_config(
    plugin_id: string,
    profile_id: string,
    action_id: string,
    input?: PluginJsonValue,
  ): Promise<PluginJsonValue>;
}

/** City Plugin main 需要宿主提供的平台能力。 */
export interface CityPluginHost {
  /** 返回绑定指定 Plugin/Profile 的配置存储。 */
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
  /** City 可选的平台 main 能力。 */
  readonly host?: CityPluginHost;
}

/** City 内一个已激活的 Plugin main。 */
export interface CityPluginMainRecord {
  /** 当前 Plugin 注册。 */
  readonly registration: CityPluginRegistration;
  /** main 激活时使用的稳定上下文。 */
  readonly context: PluginMainContext;
  /** mainview 业务 action。 */
  readonly plugin_actions: Map<string, PluginMainAction>;
  /** Profile config action。 */
  readonly config_actions: Map<string, PluginConfigMainAction>;
}

/** City 内一个共享 Plugin/Profile 实例。 */
export interface CitySharedPluginRecord {
  /** `(plugin_id, profile_id)` 唯一键。 */
  readonly key: string;
  /** Plugin 稳定 ID。 */
  readonly plugin_id: string;
  /** 创建当前实例的统一 City Plugin 模块。 */
  readonly module: CityPluginModule;
  /** 当前共享 Profile。 */
  readonly profile: PluginProfile;
  /** City 持有的唯一 Plugin 实例。 */
  readonly plugin: Plugin;
  /** 共享生命周期使用的 City 日志器。 */
  readonly logger: Logger;
  /** 不含 lifecycle 的 Agent 执行投影。 */
  readonly execution_plugin: Plugin;
  /** 共享实例启动流程。 */
  ready: Promise<void>;
  /** lifecycle.start 是否已经成功。 */
  lifecycle_started: boolean;
  /** 当前引用该实例的 Agent ID。 */
  readonly agent_ids: Set<string>;
}

/** City Plugin Runtime 内单个 Agent 的绑定状态。 */
export interface CityAgentPluginRuntimeRecord {
  /** 当前 Agent 实例。 */
  readonly agent: Agent;
  /** 当前 Agent 的只读执行 Registry。 */
  readonly registry: PluginRegistry;
  /** 按 Plugin ID 索引的共享实例绑定。 */
  readonly shared_by_plugin: Map<string, CitySharedPluginRecord>;
  /** 初始绑定失败但仍需对宿主可观察的错误快照。 */
  readonly failed_snapshots: Map<string, PluginSnapshot>;
  /** 初始绑定与生命周期启动流程。 */
  ready: Promise<void>;
  /** 当前 Agent 的动态绑定修改串行链。 */
  mutation_chain: Promise<void>;
}
