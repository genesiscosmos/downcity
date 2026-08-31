/**
 * Plugin main 的宿主运行协议。
 *
 * Plugin main 只注册管理动作并持有 Plugin 自己的长期资源。具体 Profile 配置由每次
 * action 调用上下文注入，避免一个全局 main 实例错误绑定到单个 Profile。
 */

import type { PluginJsonObject, PluginJsonValue } from "./Json.js";

/** Plugin main 注册的一个 Renderer 可调用动作。 */
export interface PluginMainAction {
  /** Plugin 内稳定且唯一的动作 ID。 */
  readonly id: string;

  /** 执行动作；输入和输出必须可以序列化为 JSON。 */
  readonly run: (
    input: PluginJsonValue | undefined,
    context: PluginMainActionContext,
  ) => PluginJsonValue | Promise<PluginJsonValue>;
}

/** 当前 Plugin/Profile 范围内的配置存储。 */
export interface PluginProfileConfigStore {
  /** 读取当前 Profile 的完整配置快照。 */
  get(): Promise<PluginJsonObject>;

  /** 原子替换当前 Profile 的完整配置。 */
  set(config: PluginJsonObject): Promise<void>;
}

/** 每次 main action 调用获得的动态上下文。 */
export interface PluginMainActionContext {
  /** 已绑定当前 Plugin 和 Profile 的配置存储。 */
  readonly config: PluginProfileConfigStore;
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

  /** 注册一个供 Mainview 调用的动作。 */
  action(action: PluginMainAction): void;
}

/** Plugin main 激活时由宿主注入的稳定能力。 */
export interface PluginMainContext {
  /** 当前 Plugin 的自身能力。 */
  readonly plugin: PluginMainSelf;

  /** Plugin 独享的结构化日志器。 */
  readonly logger: PluginMainLogger;

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
