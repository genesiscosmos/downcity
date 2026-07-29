/**
 * Agent 与 Plugin 的全局绑定类型。
 *
 * 关键点（中文）：配置属于 City 数据库中的绑定记录，不属于运行时 Plugin 对象。
 */

import type { JsonObject } from "@downcity/agent";

/** 单个 Agent 的 Plugin 启用与配置记录。 */
export interface AgentPluginBinding {
  /** 目标 Agent 的稳定 ID。 */
  agent_id: string;

  /** 目标 Plugin 的稳定名称。 */
  plugin_name: string;

  /** Agent 启动时是否实例化该 Plugin。 */
  enabled: boolean;

  /** 已通过 Manifest Schema 校验的完整配置。 */
  config: JsonObject;

  /** 当前 Plugin 实例需要解析的全局 Resource ID 列表。 */
  resource_ids: string[];

  /** 首次绑定时间，使用 ISO 8601 字符串。 */
  created_at: string;

  /** 最近更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}

/** 写入 Agent Plugin Binding 的输入。 */
export interface SetAgentPluginBindingInput {
  /** 目标 Agent 的稳定 ID。 */
  agent_id: string;

  /** 目标 Plugin 的稳定名称。 */
  plugin_name: string;

  /** Agent 启动时是否实例化该 Plugin。 */
  enabled: boolean;

  /** 需要持久化的完整结构化配置。 */
  config: JsonObject;

  /** 当前 Plugin 实例绑定的 Resource ID 列表。 */
  resource_ids: string[];
}
