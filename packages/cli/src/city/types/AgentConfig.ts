/**
 * Agent 全局配置存储类型。
 *
 * 关键点（中文）
 * - CLI 托管的 Agent 配置统一保存在全局 DB，不再写入项目目录。
 * - 类型只描述持久化形态；读写、迁移与规范化逻辑由 registry 层负责。
 */

import type { DowncityConfig } from "@/city/types/config/DowncityConfig.js";

/**
 * DB 内保存的单个 Agent 配置。
 */
export interface StoredAgentConfig {
  /** agent 项目根目录。 */
  project_root: string;
  /** agent 稳定标识。 */
  id: string;
  /** 配置版本。 */
  version: string;
  /** daemon 启动参数。 */
  start?: DowncityConfig["start"];
  /** City AIService execution binding。 */
  execution?: DowncityConfig["execution"];
  /** plugin 运行参数。 */
  plugins?: DowncityConfig["plugins"];
  /** LLM 宿主配置。 */
  llm?: DowncityConfig["llm"];
  /** 创建时间。 */
  created_at: string;
  /** 更新时间。 */
  updated_at: string;
}

/**
 * 旧版 DB 聚合配置结构，仅供内部 schema 迁移读取。
 */
export interface LegacyAgentConfigsState {
  /** 状态版本。 */
  v: 1;
  /** 所有 agent 配置。 */
  configs: StoredAgentConfig[];
}
