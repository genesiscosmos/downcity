/**
 * Downcity Agent 与 Workspace Registry 的公开数据类型。
 *
 * Agent 描述可复用的执行配置，Workspace 描述可运行的项目资源。二者只在一次
 * Runtime 创建时组合，不在 Registry 中建立永久绑定。
 */

/** CLI 与 Desktop 共享的 Agent 注册记录。 */
export interface AgentRegistryRecord {
  /** Agent 全局稳定标识。 */
  agent_id: string;

  /** Agent 配置结构版本。 */
  version: string;

  /** 可选宿主启动配置。 */
  start?: Record<string, unknown>;

  /** 可选模型执行配置。 */
  execution?: Record<string, unknown>;

  /** 可选 LLM 行为配置。 */
  llm?: Record<string, unknown>;

  /** 创建时间，使用 ISO 8601 字符串。 */
  created_at: string;

  /** 更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}

/** 创建 Agent 时的输入。 */
export interface CreateAgentRegistryInput {
  /** Agent 全局稳定标识。 */
  agent_id: string;

  /** 可选 Agent 配置结构版本。 */
  version?: string;

  /** 可选宿主启动配置。 */
  start?: Record<string, unknown>;

  /** 可选模型执行配置。 */
  execution?: Record<string, unknown>;

  /** 可选 LLM 行为配置。 */
  llm?: Record<string, unknown>;
}

/** 更新 Agent 时的输入。 */
export interface UpdateAgentRegistryInput {
  /** 目标 Agent ID。 */
  agent_id: string;

  /** 新宿主启动配置。 */
  start?: Record<string, unknown>;

  /** 新模型执行配置。 */
  execution?: Record<string, unknown>;

  /** 新 LLM 行为配置。 */
  llm?: Record<string, unknown>;
}

/** CLI 与 Desktop 共享的 Workspace 注册记录。 */
export interface WorkspaceRegistryRecord {
  /** Workspace 全局稳定标识，不由物理路径推导。 */
  workspace_id: string;

  /** Workspace 当前指向的绝对路径。 */
  workspace_path: string;

  /** Workspace 的用户可见名称。 */
  name: string;

  /** 创建时间，使用 ISO 8601 字符串。 */
  created_at: string;

  /** 更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}

/** 创建 Workspace 时的输入。 */
export interface CreateWorkspaceRegistryInput {
  /** 可选稳定 ID；省略时由 Registry 生成。 */
  workspace_id?: string;

  /** Workspace 绝对或相对路径。 */
  workspace_path: string;

  /** 可选用户可见名称；省略时使用目录名。 */
  name?: string;
}

/** 更新 Workspace 时的输入。 */
export interface UpdateWorkspaceRegistryInput {
  /** 目标 Workspace ID。 */
  workspace_id: string;

  /** 新 Workspace 路径。 */
  workspace_path?: string;

  /** 新用户可见名称。 */
  name?: string;
}
