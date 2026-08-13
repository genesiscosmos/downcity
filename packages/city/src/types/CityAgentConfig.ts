/**
 * City Agent 装配配置。
 *
 * 配置只包含宿主装配 Agent 所需的产品数据，不允许包含 Agent、Workspace、Plugin、
 * Model 或其他运行时对象。
 */

import type { JsonObject } from "@downcity/agent";

/** City 配置中的单个 Plugin 绑定。 */
export interface CityPluginBindingConfig {
  /** Plugin 的全局稳定名称。 */
  plugin_name: string;

  /** 当前 Agent 是否启用该 Plugin。 */
  enabled: boolean;

  /** 创建 Plugin 实例时使用的结构化配置。 */
  config: JsonObject;

  /** 当前 Plugin 引用的全局 Resource ID。 */
  resource_ids: readonly string[];
}

/** City 装配一个 Agent 所需的 Workspace 配置。 */
export interface CityWorkspaceRecord {
  /** Workspace 的全局稳定 ID。 */
  workspace_id: string;

  /** Workspace 当前对应的绝对路径。 */
  workspace_path: string;

  /** Workspace 的用户可见名称。 */
  name: string;
}

/** City Store 提供的单个 Agent 装配配置。 */
export interface CityAgentConfig {
  /** Agent 的全局稳定 ID。 */
  agent_id: string;

  /** 当前配置格式版本。 */
  version: string;

  /** Agent 唯一绑定的 Workspace 记录。 */
  workspace: CityWorkspaceRecord;

  /** 默认模型等执行配置；字段由具体 Environment 解释。 */
  execution?: JsonObject;

  /** LLM 行为配置；字段由具体 Environment 解释。 */
  llm?: JsonObject;

  /** 当前 Agent 的 Plugin 启用状态与装配参数。 */
  plugins: readonly CityPluginBindingConfig[];
}
