/**
 * Agent 默认模型配置相关 CLI 类型。
 *
 * 关键点（中文）
 * - CLI 持久化 Agent 配置中的结构化 `execution.model`。
 * - Session 模型通过 RemoteSession 提交结构化选择。
 */
import type { ModelReference } from "@downcity/type";
/** `downcity agent model` 命令选项。 */
export interface AgentModelCommandOptions {
  /** 直接设置的 Downtown model id；省略时进入交互选择。 */
  set?: string;
}

/** Agent 默认模型配置结果。 */
export interface AgentModelConfigurationResult {
  /** 目标 Agent 稳定 ID。 */
  agent_id: string;

  /** 修改前的 model id；未配置时为空字符串。 */
  previous_model: ModelReference | null;

  /** 修改后的 Downtown model id。 */
  current_model: ModelReference;

  /** 本次操作是否实际修改了模型。 */
  changed: boolean;
}

/** Downtown 模型选择器响应。 */
export interface AgentModelSelectionResponse {
  /** 用户选择的 Downtown model id；取消选择时不存在。 */
  model?: ModelReference;
}

/** 已登记 Agent 的模型配置目标。 */
export interface AgentModelAgentTarget {
  /** 目标 Agent 稳定 ID。 */
  agent_id: string;
}
