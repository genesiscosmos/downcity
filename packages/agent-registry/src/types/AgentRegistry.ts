/** Downcity Agent Registry 的公开数据类型。 */

/** CLI 与 Desktop 共享的最小 Agent 注册记录。 */
export interface AgentRegistryRecord {
  /** Agent 全局稳定标识。 */
  agent_id: string;
  /** Agent 绑定的 Workspace 绝对路径。 */
  workspace_path: string;
  /** 配置结构版本。 */
  version: string;
  /** 可选宿主启动配置。 */
  start?: Record<string, unknown>;
  /** 可选模型执行配置。 */
  execution?: Record<string, unknown>;
  /** 可选 LLM 配置。 */
  llm?: Record<string, unknown>;
  /** 创建时间。 */
  created_at: string;
  /** 更新时间。 */
  updated_at: string;
}

/** 创建 Agent 时的输入。 */
export type CreateAgentRegistryInput = Omit<
  AgentRegistryRecord,
  "created_at" | "updated_at"
>;

/** 更新 Agent 时的输入。 */
export interface UpdateAgentRegistryInput {
  /** 目标 Agent ID。 */
  agent_id: string;
  /** 新 Workspace 路径。 */
  workspace_path?: string;
  /** 新启动配置。 */
  start?: Record<string, unknown>;
  /** 新执行配置。 */
  execution?: Record<string, unknown>;
  /** 新 LLM 配置。 */
  llm?: Record<string, unknown>;
}
