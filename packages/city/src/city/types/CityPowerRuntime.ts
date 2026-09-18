/**
 * City Power 包内运行时类型。
 *
 * 这些类型只描述 City 唯一 Registry 与 Power 生命周期记录，
 * 不属于用户公开 API。
 */

import type { Logger } from "@downcity/agent";
import type { Embassy } from "@downcity/federation";
import type { CityRuntimeAccess } from "@/city/types/CityRuntimeAccess.js";
import type {
  CityPowerRegistration,
  PowerConfigAction,
  PowerDefinition,
  PowerHostAction,
  PowerLifecycleContext,
} from "@/power/index.js";
import type { CityPowerHost } from "@/city/types/CityPower.js";
import type { StorageProvider } from "@/workspace/index.js";

/** City Power Runtime 创建参数。 */
export interface CityPowerRuntimeOptions {
  /** City 为 Power 私有数据提供的底层存储。 */
  readonly storage: StorageProvider;
  /** City 为 Power Context 提供的 Federation Embassy。 */
  readonly embassy?: Embassy;
  /** Power Runtime 所需的 City 内部事实源访问能力。 */
  readonly runtime_access: Pick<
    CityRuntimeAccess,
    | "get_agent"
    | "list_agents"
    | "list_workspaces"
    | "require_workspace"
    | "enter_workspace"
  >;
  /** City 可选的平台宿主能力。 */
  readonly host?: CityPowerHost;
}

/** City 内唯一 Power 实例的生命周期记录。 */
export interface CityPowerRecord {
  /** Power 稳定 ID。 */
  readonly power_id: string;
  /** Power 注册元数据。 */
  readonly registration: CityPowerRegistration;
  /** City 持有的唯一 Power 实例。 */
  readonly power: PowerDefinition;
  /** Power 私有日志器。 */
  readonly logger: Logger;
  /** Power 初始化与释放共享的 City 级稳定上下文。 */
  readonly lifecycle_context: PowerLifecycleContext;
  /** Sidebar/Mainview 业务 action。 */
  readonly host_actions: Map<string, PowerHostAction>;
  /** Power 唯一配置 action。 */
  readonly config_actions: Map<string, PowerConfigAction>;
  /** Power 初始化完成的唯一 Promise。 */
  ready: Promise<void>;
  /** 当前仍在执行的宿主管理 action 数量。 */
  active_host_calls: number;
  /** 存在宿主管理 action 时等待全部调用收口的 Promise。 */
  host_calls_idle?: Promise<void>;
  /** 最后一个宿主管理 action 收口时兑现等待 Promise。 */
  resolve_host_calls_idle?: () => void;
  /** Power 是否已经进入需要释放的生命周期。 */
  lifecycle_active: boolean;
  /** Power 当前可观察状态。 */
  state: "initializing" | "ready" | "error";
  /** Power 加入 City 的时间戳。 */
  readonly registered_at: number;
  /** Power 状态最近更新时间戳。 */
  updated_at: number;
  /** Power 最近一次初始化错误。 */
  last_error?: string;
}
