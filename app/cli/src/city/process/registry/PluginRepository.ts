/**
 * City Plugin 定义与唯一配置业务仓储。
 *
 * Plugin 的代码和配置全部位于 `plugins/<plugin_id>/`，Agent 不保存 Plugin 引用。
 */

import {
  normalize_plugin_id as normalize_local_plugin_id,
  type LocalInstalledPluginDefinition,
} from "@downcity/city/local";
import type { JsonObject } from "@downcity/agent";
import { with_cli_local_data } from "@/city/runtime/LocalData.js";
import { create_cli_builtin_plugin_registrations } from "@/city/runtime/AgentAssembly.js";
import { resolve_plugin_catalog_item } from "@/city/process/plugin/PluginCatalog.js";

/** City 导出的全部内建 Plugin ID。 */
export const BUILTIN_PLUGIN_IDS = Object.freeze(
  create_cli_builtin_plugin_registrations().map((registration) => registration.plugin.name),
);

/** 规范化 Plugin 稳定 ID。 */
export function normalize_plugin_id(input: string): string {
  return normalize_local_plugin_id(input);
}

/** 判断 Plugin 是否由 City 内建数组导出。 */
export function is_builtin_plugin(plugin_id_input: string): boolean {
  return BUILTIN_PLUGIN_IDS.includes(normalize_plugin_id(plugin_id_input));
}

/** 列出全部第三方 Plugin。 */
export function list_installed_plugins(): LocalInstalledPluginDefinition[] {
  return with_cli_local_data((data) => data.plugins.list_installed());
}

/** 读取指定第三方 Plugin。 */
export function get_installed_plugin(plugin_id_input: string): LocalInstalledPluginDefinition | null {
  const plugin_id = normalize_plugin_id(plugin_id_input);
  return with_cli_local_data((data) => data.plugins.get_installed(plugin_id));
}

/** 删除一个第三方 Plugin 目录。 */
export function remove_installed_plugin(plugin_id_input: string): LocalInstalledPluginDefinition {
  const plugin_id = normalize_plugin_id(plugin_id_input);
  if (is_builtin_plugin(plugin_id)) throw new Error("Builtin Plugins cannot be uninstalled");
  const installed = get_installed_plugin(plugin_id);
  if (!installed) throw new Error(`Plugin is not installed: ${plugin_id}`);
  with_cli_local_data((data) => data.plugins.remove_installed(plugin_id));
  return installed;
}

/** 读取一个 Plugin 的唯一配置。 */
export function get_plugin_config(plugin_id_input: string): JsonObject {
  const plugin_id = normalize_plugin_id(plugin_id_input);
  return with_cli_local_data((data) => data.plugins.get_config(plugin_id));
}

/** 保存一个由 Plugin 自己负责校验的唯一配置。 */
export async function save_plugin_config(
  plugin_id_input: string,
  config: JsonObject,
): Promise<JsonObject> {
  const plugin_id = normalize_plugin_id(plugin_id_input);
  const plugin = await resolve_plugin_catalog_item(plugin_id);
  if (!plugin) throw new Error(`Plugin not found: ${plugin_id}`);
  return with_cli_local_data((data) => data.plugins.set_config(plugin_id, config));
}
