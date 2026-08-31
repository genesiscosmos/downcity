/** City 全局 Plugin Catalog。 */

import {
  list_installed_plugins,
  list_plugin_profiles,
} from "@/city/process/registry/PluginRepository.js";
import { create_cli_builtin_plugin_registrations } from "@/city/runtime/AgentAssembly.js";
import { create_cli_local_data } from "@/city/runtime/LocalData.js";
import { verify_local_installed_plugin_integrity } from "@downcity/local/product";
import type { PluginCatalogItem } from "@/city/types/plugin/PluginCatalog.js";

/** 列出全部内置与第三方 Plugin。 */
export function list_plugin_catalog(): PluginCatalogItem[] {
  const builtin_items = create_cli_builtin_plugin_registrations().map((registration) => {
    const definition = registration.definition;
    return {
      plugin_id: definition.id,
      title: definition.title || definition.id,
      description: definition.description,
      source: "builtin" as const,
      ...(definition.icon ? { icon: definition.icon } : {}),
      has_agent: definition.has_agent,
      has_main: definition.has_main,
      has_renderer: definition.has_renderer,
      profiles: list_plugin_profiles(definition.id),
    };
  });
  const installed_items = list_installed_plugins().map((plugin) => ({
    plugin_id: plugin.id,
    title: plugin.title || plugin.id,
    description: plugin.description,
    ...(plugin.icon ? { icon: plugin.icon } : {}),
    version: plugin.version,
    source: "installed" as const,
    source_label: plugin.source,
    has_agent: Boolean(plugin.agent),
    has_main: Boolean(plugin.main),
    has_renderer: Boolean(plugin.renderer),
    profiles: list_plugin_profiles(plugin.id),
  }));
  return [...builtin_items, ...installed_items]
    .sort((left, right) => left.plugin_id.localeCompare(right.plugin_id));
}

/**
 * 按稳定 ID 解析一个 Plugin 的完整管理视图。
 *
 * 解析管理视图只验证已安装制品完整性，不执行第三方 main 或 Agent 入口。
 */
export async function resolve_plugin_catalog_item(
  plugin_id: string,
): Promise<PluginCatalogItem | null> {
  const item = list_plugin_catalog().find((candidate) => candidate.plugin_id === plugin_id) ?? null;
  if (!item || item.source === "builtin") return item;
  const data = create_cli_local_data();
  try {
    const installed = data.plugins.get_installed(plugin_id);
    if (!installed) return null;
    await verify_local_installed_plugin_integrity(data.plugins.plugin_path(plugin_id), installed);
    return item;
  } finally {
    data.database.close();
  }
}
