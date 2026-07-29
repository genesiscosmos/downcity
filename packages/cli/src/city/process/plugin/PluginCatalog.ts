/**
 * City 全局 Plugin Catalog。
 *
 * 关键点（中文）
 * - 内建与用户安装 Plugin 在这里归一化，调用方不判断来源。
 * - Catalog 只描述可用制品，Agent 启用状态仍由 Plugin Binding 持有。
 */

import { CITY_BUILTIN_PLUGIN_CATALOG } from "@/city/process/plugin/BuiltinPluginCatalog.js";
import { list_installed_plugins } from "@/city/process/registry/PluginRepository.js";
import type { PluginCatalogItem } from "@/city/types/plugin/PluginCatalog.js";

/** 列出全部内建与已安装 Plugin。 */
export function list_plugin_catalog(): PluginCatalogItem[] {
  const builtin_items: PluginCatalogItem[] = CITY_BUILTIN_PLUGIN_CATALOG
    .map((definition) => ({
      plugin_name: definition.plugin_name,
      title: definition.title,
      description: definition.description,
      source: "builtin",
      actions: [...definition.actions],
      config_schema: definition.config_schema,
      resource_schema: definition.resource_schema,
      default_config: definition.default_config,
    }));
  const installed_items: PluginCatalogItem[] = list_installed_plugins()
    .map((installed) => ({
      plugin_name: installed.plugin_name,
      title: installed.manifest.title || installed.plugin_name,
      description: installed.manifest.description || "",
      version: installed.version,
      source: "installed",
      source_label: installed.source,
      actions: [],
      config_schema: installed.manifest.config?.schema,
      resource_schema: installed.manifest.resources?.schema,
      default_config: installed.manifest.config?.defaults ?? {},
    }));
  return [...builtin_items, ...installed_items]
    .sort((left, right) => left.plugin_name.localeCompare(right.plugin_name));
}

/** 按名称读取一个归一化 Plugin 目录项。 */
export function get_plugin_catalog_item(plugin_name: string): PluginCatalogItem | null {
  return list_plugin_catalog().find((item) => item.plugin_name === plugin_name) ?? null;
}
