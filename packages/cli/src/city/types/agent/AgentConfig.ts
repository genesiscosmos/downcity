/**
 * AgentConfig：Downcity 全局数据库中的 Agent 配置投影。
 *
 * Agent 与 Workspace 是独立实体；CLI 只在组合根中解析两者关系。
 */

import type { DowncityConfig } from "@/city/types/config/DowncityConfig.js";

/** Downcity 全局数据库中的单个 Agent 配置。 */
export interface AgentConfig {
  /** Agent 的全局稳定标识，也是数据库主键。 */
  agent_id: string;

  /** Agent 当前关联的 Workspace ID。 */
  workspace_id: string;

  /** Agent 配置结构版本。 */
  version: string;

  /** Federation AI 模型绑定。 */
  execution?: DowncityConfig["execution"];

  /** CLI 宿主侧 LLM 行为配置。 */
  llm?: DowncityConfig["llm"];

  /** Agent 首次创建时间，使用 ISO 8601 字符串。 */
  created_at: string;

  /** Agent 配置最近更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}

/** 创建 Agent 配置时允许调用方提供的字段。 */
export interface CreateAgentConfigInput {
  /** Agent 的全局稳定标识。 */
  agent_id: string;

  /** Agent 唯一对应的 Workspace ID。 */
  workspace_id: string;

  /** 可选 Agent 配置结构版本。 */
  version?: string;

  /** 可选模型执行绑定。 */
  execution?: AgentConfig["execution"];

  /** 可选 CLI 宿主 LLM 配置。 */
  llm?: AgentConfig["llm"];
}

/** 更新 Agent 配置时允许修改的字段。 */
export interface UpdateAgentConfigInput {
  /** 需要更新的 Agent 全局标识。 */
  agent_id: string;

  /** 新的模型执行绑定。 */
  execution?: AgentConfig["execution"];

  /** 新的 CLI 宿主 LLM 配置。 */
  llm?: AgentConfig["llm"];
}
