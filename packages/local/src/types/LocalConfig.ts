/** Downcity 本地 Agent 与 Workspace 配置管理视图。 */

import type { JsonObject } from "@downcity/agent";

/** Agent 对一个 Plugin 的持久化引用。 */
export interface LocalAgentPluginReference {
  /** Plugin 配置目录中显式选用的 profile；未填写时使用空配置。 */
  profile?: string;
}

/** 本地 Workspace 的持久化配置。 */
export interface LocalWorkspaceConfig {
  /** Workspace 的全局稳定 ID。 */
  workspace_id: string;
  /** Workspace 当前指向的真实绝对目录。 */
  workspace_path: string;
  /** Workspace 的用户可见名称。 */
  name: string;
  /** 首次登记时间，使用 ISO 8601 字符串。 */
  created_at: string;
  /** 最近更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}

/** 本地 Agent 的持久化管理视图。 */
export interface LocalAgentConfig {
  /** Agent 的全局稳定 ID。 */
  agent_id: string;
  /** 当前 Agent 定义版本。 */
  version: string;
  /** 默认模型等执行配置。 */
  execution?: JsonObject;
  /** LLM 行为配置。 */
  llm?: JsonObject;
  /** 从 `SOUL.md` 读取的 Agent 主体指令。 */
  instruction: string;
  /** 以 Plugin ID 为键的已注册 Plugin 引用。 */
  plugins: Readonly<Record<string, LocalAgentPluginReference>>;
  /** 首次注册时间，使用 ISO 8601 字符串。 */
  created_at: string;
  /** 最近更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}
