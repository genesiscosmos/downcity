/**
 * Agent 可持久化定义。
 *
 * 定义只描述 Store 可以稳定保存和恢复的配置，不包含数据库时间戳、加密字段、
 * 运行时模型对象、Plugin 实例或宿主进程配置。
 */

import type { JsonObject } from "@/types/common/Json.js";

/** 一个 Agent 的 Plugin 绑定定义。 */
export interface AgentPluginDefinition {
  /** Plugin 的全局稳定名称。 */
  plugin_name: string;

  /** 当前 Agent 是否启用该 Plugin。 */
  enabled: boolean;

  /** 用于重新创建 Plugin 实例的完整结构化配置。 */
  config: JsonObject;

  /** 当前 Plugin 引用的全局 Resource ID。 */
  resource_ids: readonly string[];
}

/** Store 可以保存并恢复的 Agent 定义。 */
export interface AgentDefinition {
  /** Agent 配置协议版本。 */
  version: string;

  /** 当前 Agent 唯一对应的 Workspace 稳定 ID。 */
  workspace_id: string;

  /** Workspace 在宿主管理界面使用的可选展示名称。 */
  workspace_name?: string;

  /** 默认模型等执行配置；字段由具体 Store Adapter 解释。 */
  execution?: JsonObject;

  /** LLM 行为配置；字段由具体 Store Adapter 解释。 */
  llm?: JsonObject;

  /** 当前 Agent 的 Plugin 启用状态和可恢复配置。 */
  plugins: readonly AgentPluginDefinition[];
}
