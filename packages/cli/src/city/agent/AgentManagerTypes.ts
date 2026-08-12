/**
 * `city agent` 交互式 manager 类型。
 */

/**
 * Agent 列表入口的选择结果。
 */
export type AgentManagerListSelection =
  | {
      /** 选择类型：进入某个已登记 Agent。 */
      type: "agent";

      /** 目标 Agent 的稳定全局 ID。 */
      agent_id: string;
    }
  | {
      /** 选择类型：创建新的 Agent 项目。 */
      type: "create";
    }
  | {
      /** 选择类型：退出 Agent 管理器。 */
      type: "exit";
    };

export type AgentManagerAgentAction =
  | "chat"
  | "configure"
  | "back";

export type AgentManagerConfigAction =
  | "configureModel"
  | "configurePlugins"
  | "configureEnv"
  | "back";

export interface AgentManagerAgentSummary {
  id: string;
  /** Agent 持久化绑定的 Workspace。 */
  project_root?: string;
  /** 当前 CLI City 是否已加载该 Agent。 */
  status: "loaded" | "unloaded";
  execution_binding?: string;
}
