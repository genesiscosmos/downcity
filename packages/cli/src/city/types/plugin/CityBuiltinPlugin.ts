/** City 内建 Plugin 目录类型。 */

import type { JsonObject } from "@downcity/agent";

/** CLI 可展示的内建 Plugin 描述。 */
export interface CityBuiltinPluginDescriptor {
  /** Plugin 稳定名称。 */
  plugin_name: string;
  /** 面向用户的标题。 */
  title: string;
  /** 面向用户的用途说明。 */
  description: string;
  /** Plugin 暴露的 Action 名称。 */
  actions: string[];
  /** 可选 Agent Binding 配置 Schema。 */
  config_schema?: JsonObject;
  /** 可选 Agent Binding 默认配置。 */
  default_config?: JsonObject;
}

/** 内建 Plugin 的 Agent Binding 配置定义。 */
export interface CityBuiltinPluginConfigDefinition {
  /** Plugin 稳定名称。 */
  plugin_name: string;
  /** Agent 首次启用时使用的默认配置。 */
  default_config: JsonObject;
  /** 可选配置 JSON Schema。 */
  config_schema?: JsonObject;
}
