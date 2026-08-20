/** CLI 与 Desktop 使用的统一 Plugin Catalog 类型。 */

import type { JsonObject } from "@downcity/agent";

/** Plugin 的本地来源。 */
export type PluginCatalogSource = "builtin" | "installed";

/** Plugin 对命名 profile 的要求。 */
export type PluginCatalogConfiguration = "none" | "optional" | "required";

/** 一个可注册到 Agent 的 Plugin。 */
export interface PluginCatalogItem {
  /** Plugin 的全局稳定 ID。 */
  plugin_id: string;
  /** 用户可见标题。 */
  title: string;
  /** 用途说明。 */
  description: string;
  /** 可选图标地址。 */
  icon?: string;
  /** 可选语义化版本号。 */
  version?: string;
  /** 内置或第三方来源。 */
  source: PluginCatalogSource;
  /** 第三方 Plugin 的规范化来源。 */
  source_label?: string;
  /** 可选 profile JSON Schema。 */
  config_schema?: JsonObject;
  /** 根据 Schema default 与 const 注解创建的新 profile 草稿。 */
  initial_config: JsonObject;
  /** Plugin 不需要、可选或必须选择命名 profile。 */
  configuration: PluginCatalogConfiguration;
  /** 当前已保存的 profile ID。 */
  profiles: string[];
}
