/**
 * CLI Agent 选择与列表展示类型。
 *
 * 关键点（中文）
 * - Agent 选择值始终是全局 `agent_id`。
 * - Workspace 路径只用于展示和当前目录便利解析。
 */

/** CLI 展示的单个受管 Agent。 */
export interface CliManagedAgentView {
  /** Agent 全局稳定标识。 */
  agent_id: string;

  /** 当前绑定的 Workspace 绝对路径。 */
  workspace_path: string;

  /** 当前 Daemon 运行状态。 */
  status: "running" | "stopped";
}

/** 交互选择器中的 Agent 选项。 */
export interface CliAgentPromptChoice {
  /** Agent ID 展示标题。 */
  title: string;

  /** 选择后返回的 Agent ID。 */
  value: string;

  /** Workspace 与运行状态说明。 */
  description: string;
}
