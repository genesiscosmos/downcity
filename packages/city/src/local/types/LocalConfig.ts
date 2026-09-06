/** Downcity 本地 Agent 与 Workspace 配置管理视图。 */

import type { JsonObject } from "@downcity/agent";

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

/** 本地 Group 的持久化配置。 */
export interface LocalGroupConfig {
  /** Group 的稳定 ID；创建后不可修改。 */
  group_id: string;
  /** Group 的用户可见名称。 */
  name: string;
  /** Group 用于理解群聊意图并决定消息投递的模型标识。 */
  model_id: string;
  /** Group 的协作目标指令。 */
  instruction: string;
  /** Group 成员 Agent 的稳定 ID 列表。 */
  member_agent_ids: readonly string[];
  /** 首次创建时间，使用 ISO 8601 字符串。 */
  created_at: string;
  /** 最近更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}

/** 本地 Agent 的持久化管理视图。 */
export interface LocalAgentConfig {
  /** Agent 的全局稳定 ID。 */
  agent_id: string;
  /** Agent 的用户可见名称。 */
  name: string;
  /** Agent 对外展示的身份简介。 */
  description: string;
  /** 当前 Agent 定义版本。 */
  version: string;
  /** 默认模型等执行配置。 */
  execution?: JsonObject;
  /** LLM 行为配置。 */
  llm?: JsonObject;
  /** 从 `SOUL.md` 读取的 Agent 主体指令。 */
  instruction: string;
  /** 首次注册时间，使用 ISO 8601 字符串。 */
  created_at: string;
  /** 最近更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}
