/** City Plugin Catalog 的统一读取模型。 */

import type { JsonObject } from "@downcity/agent";

/** Plugin 制品来源种类。 */
export type PluginCatalogSource = "builtin" | "installed";

/** 内建与外部 Plugin 归一化后的目录项。 */
export interface PluginCatalogItem {
  /** Plugin 稳定名称。 */
  plugin_name: string;

  /** 面向用户展示的标题。 */
  title: string;

  /** 面向用户展示的用途说明。 */
  description: string;

  /** 制品版本；内建 Plugin 使用当前 packages 版本语义。 */
  version?: string;

  /** 制品来自静态内建目录还是用户安装目录。 */
  source: PluginCatalogSource;

  /** 可展示的原始安装来源；内建 Plugin 不提供。 */
  source_label?: string;

  /** Plugin 对外暴露的 Action 名称。 */
  actions: string[];

  /** 标准 JSON Schema 2020-12 配置协议。 */
  config_schema?: JsonObject;

  /** 首次启用时使用且已通过 Schema 校验的默认配置。 */
  default_config: JsonObject;
}

/** 通用 Plugin 配置资源选项。 */
export interface PluginConfigResourceOption {
  /** 写入 Plugin 配置的稳定资源 ID。 */
  value: string;

  /** TUI 主标题。 */
  label: string;

  /** TUI 辅助说明。 */
  description: string;
}
