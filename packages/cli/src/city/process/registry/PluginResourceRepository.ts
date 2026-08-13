/**
 * City Plugin Resource 业务仓储。
 *
 * 关键点（中文）
 * - 所有读写都以 `plugin_name + resource_id` 定位唯一 Resource。
 * - 完整 Resource Item 在写入前按当前 Catalog Schema 校验。
 * - 被 Agent Binding 引用的 Resource 不允许删除，避免产生悬空引用。
 */

import { normalize_resource_id as normalize_local_resource_id } from "@downcity/local";
import { with_cli_local_data } from "@/city/runtime/LocalData.js";
import { get_plugin_catalog_item } from "@/city/process/plugin/PluginCatalog.js";
import { normalize_plugin_name } from "@/city/process/registry/PluginRepository.js";
import { validate_plugin_resource_item } from "@/city/process/plugin/PluginResourceSchema.js";
import type {
  PluginResourceRecord,
  SetPluginResourceInput,
} from "@/city/types/plugin/PluginResource.js";
import type { JsonObject } from "@downcity/agent";

/** 校验一个待安装版本的 Resource Schema 能继续解释全部既有 Resource。 */
export function assert_plugin_resources_compatible(
  plugin_name_input: string,
  resource_schema: JsonObject | undefined,
): void {
  const plugin_name = normalize_plugin_name(plugin_name_input);
  const resources = with_cli_local_data((data) => data.plugins.list_resources(plugin_name));
  if (resources.length === 0) return;
  if (!resource_schema) {
    throw new Error(
      `Plugin update cannot remove Resource schema while Resources exist: ${plugin_name}`,
    );
  }
  for (const resource of resources) {
    try {
      validate_plugin_resource_item(resource.item, resource_schema);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Plugin update Resource schema is incompatible with ${resource.resource_id}: ${detail}`,
      );
    }
  }
}

/** 列出一个 Plugin 的全部 Resource。 */
export function list_plugin_resources(
  plugin_name_input: string,
): PluginResourceRecord[] {
  const plugin_name = require_resource_plugin(plugin_name_input).plugin_name;
  return with_cli_local_data((data) => data.plugins.list_resources(plugin_name)) as PluginResourceRecord[];
}

/** 读取一个 Plugin Resource。 */
export function get_plugin_resource(
  plugin_name_input: string,
  resource_id_input: string,
): PluginResourceRecord | null {
  const plugin_name = require_resource_plugin(plugin_name_input).plugin_name;
  const resource_id = normalize_resource_id(resource_id_input);
  return with_cli_local_data((data) => data.plugins.get_resource(plugin_name, resource_id)) as PluginResourceRecord | null;
}

/** 保存一个完整 Plugin Resource Item。 */
export function set_plugin_resource(
  input: SetPluginResourceInput,
): PluginResourceRecord {
  const plugin = require_resource_plugin(input.plugin_name);
  const resource_id = normalize_resource_id(input.item.id);
  if (resource_id !== input.item.id) {
    throw new Error(`Plugin Resource id is not canonical: ${input.item.id}`);
  }
  validate_plugin_resource_item(input.item, plugin.resource_schema!);
  return with_cli_local_data((data) => data.plugins.save_resource({
    plugin_name: plugin.plugin_name,
    item: input.item,
  })) as PluginResourceRecord;
}

/** 删除一个没有被任何 Agent Binding 引用的 Plugin Resource。 */
export function remove_plugin_resource(
  plugin_name_input: string,
  resource_id_input: string,
): void {
  const plugin_name = require_resource_plugin(plugin_name_input).plugin_name;
  const resource_id = normalize_resource_id(resource_id_input);
  with_cli_local_data((data) => data.plugins.remove_resource(plugin_name, resource_id));
}

/** 规范化 Plugin 范围内的 Resource ID。 */
export function normalize_resource_id(input: string): string {
  return normalize_local_resource_id(input);
}

/** 要求 Plugin 存在且声明 Resource Schema。 */
function require_resource_plugin(plugin_name_input: string) {
  const plugin_name = normalize_plugin_name(plugin_name_input);
  const plugin = get_plugin_catalog_item(plugin_name);
  if (!plugin) throw new Error(`Plugin not found: ${plugin_name}`);
  if (!plugin.resource_schema) {
    throw new Error(`Plugin does not declare Resources: ${plugin_name}`);
  }
  return plugin;
}
