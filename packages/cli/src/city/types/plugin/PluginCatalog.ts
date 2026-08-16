/** CLI 与 Desktop 使用的统一 Plugin Catalog 类型。 */

import type { JsonObject } from "@downcity/agent";

/** Plugin 的本地来源。 */
export type PluginCatalogSource = "builtin" | "installed";

/** 一个可注册到 Agent 的 Plugin。 */
export interface PluginCatalogItem {
  /** Plugin 的全局稳定 ID。 */
  plugin_id: string;
  /** 用户可见标题。 */
  title: string;
  /** 用途说明。 */
  description: string;
  /** 可选语义化版本号。 */
  version?: string;
  /** 内置或第三方来源。 */
  source: PluginCatalogSource;
  /** 第三方 Plugin 的规范化来源。 */
  source_label?: string;
  /** 可选 profile JSON Schema。 */
  config_schema?: JsonObject;
  /** `default` profile 不存在时使用的默认配置。 */
  default_config: JsonObject;
  /** 当前已保存的 profile ID。 */
  profiles: string[];
}
