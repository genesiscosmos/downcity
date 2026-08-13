/**
 * City 全局 Plugin Catalog。
 *
 * 关键点（中文）
 * - Catalog 直接由内建 Plugin constructor 数组和安装快照中的 Plugin 数组组成。
 * - installation ID 只用于定位共享入口，不形成公开 Project 层级。
 * - Agent 启用状态仍由 Plugin Binding 持有。
 */

import { list_plugin_installations } from "@/city/process/registry/PluginRepository.js";
import { create_cli_builtin_plugin_types } from "@/city/runtime/AgentAssembly.js";
import type { PluginCatalogItem } from "@/city/types/plugin/PluginCatalog.js";
import type { PluginManifest } from "@/city/types/plugin/PluginInstallation.js";

/** 列出全部内建与用户安装 Plugin。 */
export function list_plugin_catalog(): PluginCatalogItem[] {
  const builtin_items = create_cli_builtin_plugin_types().map((plugin_type) =>
    to_catalog_item(plugin_type.manifest, "builtin")
  );
  const installed_items = list_plugin_installations()
    .flatMap((installation) => installation.manifest.plugins.map((manifest) =>
    to_catalog_item(
      manifest,
      "installed",
      installation.installation_id,
      installation.source,
    )
  ));
  return [...builtin_items, ...installed_items]
    .sort((left, right) => left.plugin_name.localeCompare(right.plugin_name));
}

/** 按名称读取一个归一化 Plugin 目录项。 */
export function get_plugin_catalog_item(plugin_name: string): PluginCatalogItem | null {
  return list_plugin_catalog().find((item) => item.plugin_name === plugin_name) ?? null;
}

/** 把 Plugin 静态 Manifest 投影为 Catalog Item。 */
function to_catalog_item(
  manifest: PluginManifest,
  source: PluginCatalogItem["source"],
  installation_id?: string,
  source_label?: string,
): PluginCatalogItem {
  return {
    ...(installation_id ? { installation_id } : {}),
    plugin_name: manifest.name,
    title: manifest.title || manifest.name,
    description: manifest.description,
    ...(manifest.version ? { version: manifest.version } : {}),
    source,
    ...(source_label ? { source_label } : {}),
    ...(manifest.config?.schema ? { config_schema: manifest.config.schema } : {}),
    default_config: manifest.config?.defaults ?? {},
    ...(manifest.resources?.schema ? { resource_schema: manifest.resources.schema } : {}),
  };
}
