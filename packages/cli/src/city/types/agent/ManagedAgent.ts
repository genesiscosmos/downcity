/**
 * ManagedAgent：Downcity 全局管理的 Agent 配置。
 *
 * Agent 不保存 Workspace；宿主在创建 Runtime 时把 Agent 与 Workspace 显式组合。
 */

import type { DowncityConfig } from "@/city/types/config/DowncityConfig.js";

/** Downcity 全局数据库中的单个受管 Agent。 */
export interface ManagedAgent {
  /** Agent 的全局稳定标识，也是数据库主键。 */
  agent_id: string;

  /** Agent 配置结构版本。 */
  version: string;

  /** Agent HTTP Gateway 的宿主启动配置。 */
  start?: DowncityConfig["start"];

  /** Federation AI 模型绑定。 */
  execution?: DowncityConfig["execution"];

  /** CLI 宿主侧 LLM 行为配置。 */
  llm?: DowncityConfig["llm"];

  /** Agent 首次创建时间，使用 ISO 8601 字符串。 */
  created_at: string;

  /** Agent 配置最近更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}

/** 创建受管 Agent 时允许调用方提供的字段。 */
export interface CreateManagedAgentInput {
  /** Agent 的全局稳定标识。 */
  agent_id: string;

  /** 可选 Agent 配置结构版本。 */
  version?: string;

  /** 可选 Gateway 启动配置。 */
  start?: ManagedAgent["start"];

  /** 可选模型执行绑定。 */
  execution?: ManagedAgent["execution"];

  /** 可选 CLI 宿主 LLM 配置。 */
  llm?: ManagedAgent["llm"];
}

/** 更新受管 Agent 时允许修改的字段。 */
export interface UpdateManagedAgentInput {
  /** 需要更新的 Agent 全局标识。 */
  agent_id: string;

  /** 新的 Gateway 启动配置。 */
  start?: ManagedAgent["start"];

  /** 新的模型执行绑定。 */
  execution?: ManagedAgent["execution"];

  /** 新的 CLI 宿主 LLM 配置。 */
  llm?: ManagedAgent["llm"];
}
