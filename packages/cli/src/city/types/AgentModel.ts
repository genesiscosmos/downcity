/**
 * Agent 默认模型配置相关 CLI 类型。
 *
 * 关键点（中文）
 * - CLI 只持久化 Agent 配置中的 `execution.modelId`。
 * - Session 模型是 SDK 本地运行时实例，不通过 CLI 或 RemoteSession 设置。
 */

/** `downcity agent model` 命令选项。 */
export interface AgentModelCommandOptions {
  /** 直接设置的 Federation model id；省略时进入交互选择。 */
  set?: string;
}

/** Agent 默认模型配置结果。 */
export interface AgentModelConfigurationResult {
  /** 目标 Agent 稳定 ID。 */
  agent_id: string;

  /** 修改前的 model id；未配置时为空字符串。 */
  previous_model_id: string;

  /** 修改后的 Federation model id。 */
  current_model_id: string;

  /** 本次操作是否实际修改了模型。 */
  changed: boolean;
}

/** Federation 模型选择器响应。 */
export interface AgentModelSelectionResponse {
  /** 用户选择的 Federation model id；取消选择时不存在。 */
  model_id?: string;
}

/** 已登记 Agent 的模型配置目标。 */
export interface AgentModelAgentTarget {
  /** 目标 Agent 稳定 ID。 */
  agent_id: string;
}
