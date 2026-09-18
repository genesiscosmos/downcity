/**
 * City Power 所有权与运行时协议。
 *
 * 一个 City 中每个 Power ID 只对应一个实例。City 负责实例的生命周期与执行快照；
 * 所有已注册 Agent 自动获得 City 的全部 Power。
 */

import type { Hono } from "hono";
import type {
  CityPowerRegistration,
  PowerDefinition,
  PowerJsonObject,
  PowerJsonValue,
  PowerNotificationPublisher,
  PowerConfigStore,
  PowerSnapshot,
} from "@/power/index.js";
import type { AgentPowerRuntime } from "@/power/types/PowerExecutionRuntime.js";

/** City 构造期接受的单个 Power 输入。 */
export type CityPowerInput = PowerDefinition | CityPowerRegistration;

/** City 构造期接受的 Power 集合。 */
export type CityPowerCollection =
  | readonly CityPowerInput[]
  | Readonly<Record<string, CityPowerInput>>;

/** City 对外暴露的 Power 集合。 */
export interface CityPowers {
  /**
   * 向 City 添加唯一 Power 实例或带 UI 元数据的注册项，并等待初始化完成。
   */
  add(input: CityPowerInput): Promise<void>;

  /** 从 City 移除 Power，并等待正在执行的 Hook/Action 收口。 */
  remove(power_id: string): Promise<boolean>;

  /** 返回 City 当前全部 Power 状态快照。 */
  snapshots(): PowerSnapshot[];

  /** 获取 City 当前持有的唯一 Power 实例。 */
  get(power_id: string): PowerDefinition | null;

  /** 返回指定 Agent/Workspace 的 Power 直接调用面。 */
  scope(input: {
    /** 当前调用所属 Agent 的稳定标识。 */
    readonly agent_id: string;
    /** 当前调用所属 Workspace 的稳定标识。 */
    readonly workspace_id: string;
  }): AgentPowerRuntime;

  /** 向指定应用注册一个 Agent/Workspace 下的 Power HTTP 路由。 */
  register_http_routes(
    app: Hono,
    input: {
      /** 当前请求所属 Agent 的稳定标识。 */
      readonly agent_id: string;
      /** 当前请求所属 Workspace 的稳定标识。 */
      readonly workspace_id: string;
    },
  ): void;

  /** 调用 Power 在 initialize 阶段注册的宿主管理 action。 */
  invoke(power_id: string, action_id: string, input?: PowerJsonValue): Promise<PowerJsonValue>;

  /** 调用 Power 注册的配置 action。 */
  invoke_config(
    power_id: string,
    action_id: string,
    input?: PowerJsonValue,
  ): Promise<PowerJsonValue>;
}

/** City Power 生命周期需要宿主提供的平台能力。 */
export interface CityPowerHost {
  /** 返回指定 Power 的唯一配置存储端口。 */
  config?(power_id: string): PowerConfigStore;
  /** 返回绑定当前 Power 身份的通知发布端口。 */
  notifications(power_id: string, agent_id?: string): PowerNotificationPublisher;
  /** 使用系统默认应用打开 HTTP(S) URL。 */
  open_external?(url: string): Promise<void>;
  /** 在平台文件管理器中显示绝对路径。 */
  show_item_in_folder?(path: string): Promise<void>;
  /** 写入平台剪贴板文本。 */
  write_clipboard_text?(text: string): Promise<void>;
}
