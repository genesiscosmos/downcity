/**
 * CLI 控制面使用的 Agent/Workspace 能力投影。
 *
 * 该类型只描述 CLI 路由实际需要的字段，不把 Agent 内部装配对象
 * 暴露为 CLI 的统一领域模型。
 */

import type {
  Agent,
  AgentPluginRuntime,
  AgentSessionCollection,
  SessionSystemMessage,
} from "@downcity/agent";
import type { WorkspaceBase } from "@downcity/workspace";

/** CLI 单 Agent 控制面所需的最小执行能力。 */
export interface CliAgentContext {
  /** 当前 Agent 实例。 */
  agent: Agent;
  /** 当前请求绑定的 Workspace。 */
  workspace: WorkspaceBase;
  /** 当前 Workspace 稳定标识。 */
  workspace_id: string;
  /** 当前 Agent 私有数据根目录。 */
  data_path: string;
  /** 当前 Agent 的唯一 Session 集合。 */
  sessions: AgentSessionCollection;
  /** 当前 Workspace 下的 Plugin 调用面。 */
  plugins: AgentPluginRuntime;
  /** Agent 稳定标识。 */
  id: string;
  /** 读取当前 Plugin 状态。 */
  list_plugin_states: () => ReturnType<AgentPluginRuntime["snapshots"]>;
  /** 解析指定 Session 的 system messages。 */
  resolve_system_messages: (input: {
    /** 目标 Session ID。 */
    session_id: string;
    /** system message profile。 */
    profile?: "chat" | "task";
  }) => Promise<SessionSystemMessage[]>;
  /** 注册当前 Workspace 下的 Plugin HTTP 路由。 */
  register_plugin_http_routes: (app: import("hono").Hono) => void;
}
