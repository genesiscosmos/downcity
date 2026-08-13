/**
 * CLI Agent 选择与列表展示类型。
 *
 * 关键点（中文）
 * - Agent 选择值始终是全局 `agent_id`。
 * - Workspace 路径描述 Agent 持久化绑定的 Workspace。
 */

/** CLI 展示的单个 Agent 运行目标。 */
export interface CliAgentView {
  /** Agent 全局稳定标识。 */
  agent_id: string;

  /** Agent 持久化绑定的 Workspace 路径；历史异常记录可能不存在。 */
  workspace_path?: string;

  /** 当前 CLI City daemon 是否已加载该 Agent。 */
  status: "loaded" | "unloaded";
}

/** 交互选择器中的 Agent 选项。 */
export interface CliAgentPromptChoice {
  /** Agent ID 展示标题。 */
  title: string;

  /** 选择后返回的 Agent ID。 */
  value: string;

  /** Agent 绑定的 Workspace 与当前宿主状态说明。 */
  description: string;
}
