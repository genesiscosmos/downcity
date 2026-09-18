/**
 * CLI 控制面使用的 Agent/Workspace 能力投影。
 *
 * 该类型只描述 CLI 路由实际需要的字段，不把 Agent 内部装配对象
 * 暴露为 CLI 的统一领域模型。
 */

import type {
  Agent,
  AgentSessionCollection,
  SessionSystemMessage,
} from "@downcity/agent";
import type { City } from "@downcity/city";
import type { WorkspaceRuntime } from "@downcity/type/workspace";

/** City 为一个 Agent/Workspace 投影的 Power 调用面。 */
type CityPowerScope = ReturnType<City["powers"]["scope"]>;

/** CLI 单 Agent 控制面所需的最小执行能力。 */
export interface CliAgentContext {
  /** 当前 Agent 实例。 */
  agent: Agent;
  /** 当前请求绑定的 Workspace。 */
  workspace: WorkspaceRuntime;
  /** 当前 Workspace 稳定标识。 */
  workspace_id: string;
  /** 当前 Agent 私有数据根目录。 */
  data_path: string;
  /** 当前 Agent 的唯一 Session 集合。 */
  sessions: AgentSessionCollection;
  /** 当前 Workspace 下的 Power 调用面。 */
  powers: CityPowerScope;
  /** Agent 稳定标识。 */
  id: string;
  /** 读取当前 Power 状态。 */
  list_power_states: () => ReturnType<CityPowerScope["snapshots"]>;
  /** 解析指定 Session 的 system messages。 */
  resolve_system_messages: (input: {
    /** 目标 Session ID。 */
    session_id: string;
  }) => Promise<SessionSystemMessage[]>;
  /** 注册当前 Workspace 下的 Power HTTP 路由。 */
  register_power_http_routes: (app: import("hono").Hono) => void;
}
