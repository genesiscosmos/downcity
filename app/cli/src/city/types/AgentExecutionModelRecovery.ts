/**
 * Agent execution 模型恢复类型。
 *
 * 关键点（中文）
 * - 只描述已保存模型与当前 Federation 模型目录之间的决策结果。
 * - TTY 选择、配置写回和错误展示由 CLI 运行层负责。
 */

/** 模型恢复决策输入。 */
export interface AgentExecutionModelRecoveryInput {
  /** Agent 配置当前保存的默认模型 ID。 */
  configured_model_id: string;
  /** 当前 Federation 可用于 Agent 对话的模型 ID。 */
  available_model_ids: string[];
}

/** 已保存模型仍可直接使用。 */
export interface AgentExecutionModelReadyDecision {
  /** 表示无需修改配置。 */
  kind: "ready";
  /** 当前可继续使用的模型 ID。 */
  model_id: string;
}

/** 已保存模型失配，需要用户重新选择。 */
export interface AgentExecutionModelSelectionDecision {
  /** 表示当前 Federation 有模型，但已保存模型不可用。 */
  kind: "selection_required";
  /** 当前失配的旧模型 ID；未配置时为空字符串。 */
  previous_model_id: string;
}

/** 当前 Federation 没有可选执行模型。 */
export interface AgentExecutionModelUnavailableDecision {
  /** 表示当前 Federation 无法提供任何 Agent 执行模型。 */
  kind: "unavailable";
  /** 当前失配的旧模型 ID；未配置时为空字符串。 */
  previous_model_id: string;
}

/** Agent 启动前的模型恢复决策。 */
export type AgentExecutionModelRecoveryDecision =
  | AgentExecutionModelReadyDecision
  | AgentExecutionModelSelectionDecision
  | AgentExecutionModelUnavailableDecision;
