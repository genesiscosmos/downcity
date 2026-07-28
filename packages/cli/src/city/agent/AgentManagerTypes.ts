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
  | "start"
  | "stop"
  | "restart"
  | "chat"
  | "configure"
  | "back";

export type AgentManagerConfigAction =
  | "configureModel"
  | "configurePlugins"
  | "back";

export interface AgentManagerAgentSummary {
  id: string;
  project_root: string;
  status: "running" | "stopped";
  execution_binding?: string;
}
