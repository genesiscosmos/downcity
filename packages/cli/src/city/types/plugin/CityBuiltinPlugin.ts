/** City 内建 Plugin 目录类型。 */

import type { JsonObject } from "@downcity/agent";

/** 内建 Plugin 的 Agent Binding 配置定义。 */
export interface CityBuiltinPluginCatalogDefinition {
  /** Plugin 稳定名称。 */
  plugin_name: string;

  /** 面向用户展示的 Plugin 标题。 */
  title: string;

  /** 面向用户说明 Plugin 用途的描述。 */
  description: string;

  /** Plugin 对外提供的稳定 Action 名称快照。 */
  actions: readonly string[];

  /** Agent 首次启用时使用的默认配置。 */
  default_config: JsonObject;

  /** 可选配置 JSON Schema。 */
  config_schema?: JsonObject;
}
