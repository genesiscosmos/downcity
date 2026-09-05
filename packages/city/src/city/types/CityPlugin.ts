/**
 * City Plugin 所有权与运行时协议。
 *
 * 一个 City 中每个 Plugin ID 只对应一个实例。City 负责实例的启动、作用域连接、
 * 执行快照和停止；所有已注册 Agent 自动获得 City 的全部 Plugin。
 */

import type { Hono } from "hono";
import type {
  CityPluginRegistration,
  PluginDefinition,
  PluginJsonObject,
  PluginJsonValue,
  PluginNotificationPublisher,
  PluginProfileConfigStore,
  PluginSnapshot,
} from "@/plugin/index.js";
import type { AgentPluginRuntime } from "@/plugin/types/PluginExecutionRuntime.js";

/** City 构造期接受的单个 Plugin 输入。 */
export type CityPluginInput = PluginDefinition | CityPluginRegistration;

/** City 构造期接受的 Plugin 集合。 */
export type CityPluginCollection =
  | readonly CityPluginInput[]
  | Readonly<Record<string, CityPluginInput>>;

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
