/** City 全局 Plugin Catalog。 */

import {
  list_installed_plugins,
  list_plugin_profiles,
} from "@/city/process/registry/PluginRepository.js";
import { create_cli_builtin_plugin_types } from "@/city/runtime/AgentAssembly.js";
import type { PluginCatalogItem } from "@/city/types/plugin/PluginCatalog.js";

/** 列出全部内置与第三方 Plugin。 */
export function list_plugin_catalog(): PluginCatalogItem[] {
  const builtin_items = create_cli_builtin_plugin_types().map((plugin_type) => {
    const manifest = plugin_type.manifest;
    return {
      plugin_id: manifest.name,
      title: manifest.title || manifest.name,
      description: manifest.description,
      source: "builtin" as const,
      ...(manifest.config?.schema ? { config_schema: manifest.config.schema } : {}),
      default_config: manifest.config?.defaults ?? {},
      profiles: list_plugin_profiles(manifest.name),
    };
  });
  const installed_items = list_installed_plugins().map((plugin) => ({
    plugin_id: plugin.id,
    title: plugin.title || plugin.id,
    description: plugin.description,
    version: plugin.version,
    source: "installed" as const,
    source_label: plugin.source,
    ...(plugin.config_schema ? { config_schema: plugin.config_schema } : {}),
    default_config: plugin.default_config ?? {},
    profiles: list_plugin_profiles(plugin.id),
  }));
  return [...builtin_items, ...installed_items]
    .sort((left, right) => left.plugin_id.localeCompare(right.plugin_id));
}

/** 按稳定 ID 读取一个 Plugin。 */
export function get_plugin_catalog_item(plugin_id: string): PluginCatalogItem | null {
  return list_plugin_catalog().find((item) => item.plugin_id === plugin_id) ?? null;
}
