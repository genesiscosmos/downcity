/**
 * Plugin main 的宿主运行协议。
 *
 * Plugin main 只注册管理动作并持有 Plugin 自己的长期资源。业务动作与 Config 动作
 * 分别注册，避免没有配置界面的 Plugin 被错误绑定到 Profile。
 */

import type { PluginJsonObject, PluginJsonValue } from "./Json.js";
import type { PluginNotificationPublisher } from "./PluginNotification.js";

/** Plugin main 注册的一个 Sidebar/Mainview 业务动作。 */
export interface PluginMainAction {
  /** Plugin 内稳定且唯一的动作 ID。 */
  readonly id: string;

  /** 执行动作；输入和输出必须可以序列化为 JSON。 */
  readonly run: (input: PluginJsonValue | undefined) =>
    PluginJsonValue | Promise<PluginJsonValue>;
}

/** Plugin main 注册的一个 Config 动作。 */
export interface PluginConfigMainAction {
  /** Plugin 内稳定且唯一的动作 ID。 */
  readonly id: string;

  /** 在当前 Profile 配置范围内执行动作。 */
  readonly run: (
    input: PluginJsonValue | undefined,
    context: PluginConfigMainActionContext,
  ) => PluginJsonValue | Promise<PluginJsonValue>;
}

/** 当前 Plugin/Profile 范围内的配置存储。 */
export interface PluginProfileConfigStore {
  /** 读取当前 Profile 的完整配置快照。 */
  get(): Promise<PluginJsonObject>;

  /** 原子替换当前 Profile 的完整配置。 */
  set(config: PluginJsonObject): Promise<void>;
}

/** 每次 Config action 调用获得的动态上下文。 */
export interface PluginConfigMainActionContext {
  /** 已绑定当前 Plugin 和 Profile 的配置存储。 */
  readonly config: PluginProfileConfigStore;
}

/** 宿主登记且允许 Plugin main 感知的 Workspace。 */
export interface PluginMainWorkspace {
  /** Workspace 的稳定 ID。 */
  readonly workspace_id: string;

  /** Workspace 的用户可见名称。 */
  readonly name: string;

  /** Workspace 的绝对根路径。 */
  readonly workspace_path: string;
}

/** Plugin main 可管理的宿主 Agent 摘要。 */
export interface PluginMainAgent {
  /** Agent 的稳定 ID。 */
  readonly agent_id: string;

  /** Agent 的用户可见名称。 */
  readonly name: string;

  /** Agent 当前启用的 Plugin ID。 */
  readonly plugin_ids: string[];
}

/** Plugin main 的结构化日志能力。 */
export interface PluginMainLogger {
  /** 写入调试日志。 */
  debug(message: string, data?: PluginJsonObject): void;

  /** 写入普通运行日志。 */
  info(message: string, data?: PluginJsonObject): void;

  /** 写入可恢复问题日志。 */
  warn(message: string, data?: PluginJsonObject): void;

  /** 写入失败日志。 */
  error(message: string, data?: PluginJsonObject): void;
}

/** Plugin main 可使用的宿主系统能力。 */
export interface PluginMainSystem {
  /** 列出宿主当前登记的 Agent 及其 Plugin。 */
  list_agents(): Promise<PluginMainAgent[]>;

  /** 列出宿主当前登记的 Workspace，供 Plugin 自己的管理功能使用。 */
  list_workspaces(): Promise<PluginMainWorkspace[]>;

  /** 在指定 Agent 与 Workspace 上调用一个 Agent Plugin action。 */
  invoke_agent_plugin(input: {
    /** 目标 Agent 的稳定 ID。 */
    readonly agent_id: string;

    /** 提供执行上下文的 Workspace ID。 */
    readonly workspace_id: string;

    /** 目标 Agent Plugin ID。 */
    readonly plugin_id: string;

    /** 目标 action ID。 */
    readonly action_id: string;

    /** 传递给 action 的可选 JSON 输入。 */
    readonly input?: PluginJsonValue;
  }): Promise<PluginJsonValue>;

  /** 使用系统默认应用打开 HTTP 或 HTTPS 地址。 */
  open_external(input: {
    /** 要打开的绝对 URL。 */
    readonly url: string;
  }): Promise<void>;

  /** 在系统文件管理器中显示一个绝对路径。 */
  show_item_in_folder(input: {
    /** 要显示的绝对文件路径。 */
    readonly path: string;
  }): Promise<void>;

  /** 把纯文本写入系统剪贴板。 */
  write_clipboard_text(input: {
    /** 要写入剪贴板的文本。 */
    readonly text: string;
  }): Promise<void>;
}

/** Plugin main 对自身运行时的受限操作。 */
export interface PluginMainSelf {
  /** 当前 Plugin 的稳定 ID。 */
  readonly id: string;

  /** 注册一个供 Plugin Sidebar/Mainview 调用的业务动作。 */
  action(action: PluginMainAction): void;

  /** 注册一个供 Plugin Config 调用的配置动作。 */
  config_action(action: PluginConfigMainAction): void;
}

/** Plugin main 激活时由宿主注入的稳定能力。 */
export interface PluginMainContext {
  /** 当前 Plugin 的自身能力。 */
  readonly plugin: PluginMainSelf;

  /** Plugin 独享的结构化日志器。 */
  readonly logger: PluginMainLogger;

  /** 已绑定当前 Plugin 身份的宿主通知发布能力。 */
  readonly notifications: PluginNotificationPublisher;

  /** 明确授权的宿主系统辅助能力。 */
  readonly system: PluginMainSystem;
}

/** Plugin main 模块默认导出的生命周期对象。 */
export interface PluginMainModule {
  /** 注册动作并启动 Plugin 自己拥有的长期资源。 */
  activate(context: PluginMainContext): void | Promise<void>;

  /** 注销前释放 Plugin main 创建的全部长期资源。 */
  deactivate?(context: PluginMainContext): void | Promise<void>;
}
