/**
 * LocalCityStore 对外配置类型。
 *
 * 这些类型描述本地 Store 的稳定输入和管理视图，不暴露数据库行、密文或连接细节。
 */

import type { JsonObject } from "@downcity/agent";
import type { CityPluginBindingConfig } from "@/types/CityAgentConfig.js";

/** 本地 City Store 构造参数。 */
export interface LocalCityStoreOptions {
  /** Downcity 用户级数据根目录；默认使用 `~/.downcity`。 */
  root_path?: string;

  /** 当前宿主需要装配的 Agent ID；省略时读取 Store 中的全部配置。 */
  agent_ids?: readonly string[];

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

  /** 当前 Agent 对应的 Workspace；历史未绑定记录暂时为空。 */
  workspace_id?: string;

  /** 当前配置格式版本。 */
  version: string;

  /** 默认模型等执行配置。 */
  execution?: JsonObject;

  /** LLM 行为配置。 */
  llm?: JsonObject;

  /** 当前 Agent 的 Plugin 启用状态与装配参数。 */
  plugins: readonly CityPluginBindingConfig[];

  /** 首次注册时间，使用 ISO 8601 字符串。 */
  created_at: string;

  /** 最近更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}
