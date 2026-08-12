/**
 * CLI Agent 选择与列表展示类型。
 *
 * 关键点（中文）
 * - Agent 选择值始终是全局 `agent_id`。
 * - Workspace 路径只描述当前 daemon 的临时运行目标。
 */

/** CLI 展示的单个受管 Agent。 */
export interface CliManagedAgentView {
  /** Agent 全局稳定标识。 */
  agent_id: string;

  /** 当前 daemon 实际使用的 Workspace；未运行时不存在。 */
  workspace_path?: string;

  /** 当前 Daemon 运行状态。 */
  status: "running" | "stopped";
}

/** 交互选择器中的 Agent 选项。 */
export interface CliAgentPromptChoice {
  /** Agent ID 展示标题。 */
  title: string;

  /** 选择后返回的 Agent ID。 */
  value: string;

  /** 当前运行 Workspace 与状态说明。 */
  description: string;
}
