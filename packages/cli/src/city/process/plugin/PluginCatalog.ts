/** City 全局 Plugin Catalog。 */

import {
  list_installed_plugins,
  list_plugin_profiles,
} from "@/city/process/registry/PluginRepository.js";
import { create_cli_builtin_plugin_registrations } from "@/city/runtime/AgentAssembly.js";
import { create_local_plugin_config_definition } from "@downcity/local/product";
import type { PluginCatalogItem } from "@/city/types/plugin/PluginCatalog.js";

/** 列出全部内置与第三方 Plugin。 */
export function list_plugin_catalog(): PluginCatalogItem[] {
  const builtin_items = create_cli_builtin_plugin_registrations().map((registration) => {
    const definition = registration.definition;
    const config = create_local_plugin_config_definition(
      registration.type?.config,
      `Plugin ${definition.id} type.config`,
    );
    return {
      plugin_id: definition.id,
      title: definition.title || definition.id,
      description: definition.description,
      source: "builtin" as const,
      ...(config?.schema ? { config_schema: config.schema } : {}),
      default_config: config?.defaults ?? {},
      profiles: list_plugin_profiles(definition.id),
    };
  });
  const installed_items = list_installed_plugins().map((plugin) => ({
    plugin_id: plugin.id,
    title: plugin.title || plugin.id,
    description: plugin.description,
    version: plugin.version,
    source: "installed" as const,
    source_label: plugin.source,
    ...(plugin.config?.schema ? { config_schema: plugin.config.schema } : {}),
    default_config: plugin.config?.defaults ?? {},
    profiles: list_plugin_profiles(plugin.id),
  }));
  return [...builtin_items, ...installed_items]
    .sort((left, right) => left.plugin_id.localeCompare(right.plugin_id));
}

/** 按稳定 ID 读取一个 Plugin。 */
export function get_plugin_catalog_item(plugin_id: string): PluginCatalogItem | null {
  return list_plugin_catalog().find((item) => item.plugin_id === plugin_id) ?? null;
}
