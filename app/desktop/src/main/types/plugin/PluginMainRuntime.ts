/** Desktop Plugin main runtime 的内部装配类型。 */

import type {
  PluginConfigMainAction,
  PluginMainAction,
  PluginMainContext,
  PluginMainModule,
  PluginNotificationInput,
  PluginNotificationTopicInput,
} from "@downcity/plugin";
import type { PluginJsonValue } from "@downcity/plugin";

/** 一个已经激活的 Plugin main。 */
export interface ActivePluginMain {
  /** Plugin main 生命周期对象。 */
  readonly module: PluginMainModule;

  /** 激活时注入并在关闭时复用的稳定上下文。 */
  readonly context: PluginMainContext;

  /** 按稳定 ID 注册的全部 Plugin 级动作。 */
  readonly plugin_actions: Map<string, PluginMainAction>;

  /** 按稳定 ID 注册的全部 Config 动作。 */
  readonly config_actions: Map<string, PluginConfigMainAction>;
}

/** Plugin main action 所属的 Renderer 界面。 */
export type PluginMainActionSurface = "mainview" | "config";

/** Plugin main 模块解析结果。 */
export interface ResolvedPluginMain {
  /** 当前 Plugin 的稳定 ID。 */
  readonly plugin_id: string;

  /** 已加载且通过结构校验的 main 生命周期对象。 */
  readonly module: PluginMainModule;
}

/** Plugin main runtime 的依赖。 */
export interface PluginMainRuntimeOptions {
  /** 按 Plugin ID 延迟解析内置或第三方 main。 */
  readonly resolve_main: (plugin_id: string) => Promise<ResolvedPluginMain | null>;

  /** 在 Desktop Agent runtime 中调用 Agent Plugin action。 */
  readonly invoke_agent_plugin: (input: {
    /** 目标 Agent ID。 */
    readonly agent_id: string;
    /** 执行上下文 Workspace ID。 */
    readonly workspace_id: string;
    /** 目标 Plugin ID。 */
    readonly plugin_id: string;
    /** 目标 action ID。 */
    readonly action_id: string;
    /** 可选 action 输入。 */
    readonly input?: PluginJsonValue;
  }) => Promise<PluginJsonValue>;

  /** 发布一条已绑定来源 Plugin 的宿主通知。 */
  readonly publish_notification: (
    plugin_id: string,
    input: PluginNotificationInput,
  ) => Promise<void>;

  /** 清除当前 Plugin 命名空间内一个通知主题。 */
  readonly dismiss_notification: (
    plugin_id: string,
    input: PluginNotificationTopicInput,
  ) => Promise<void>;
}
