/**
 * City Plugin Resource 业务仓储。
 *
 * 关键点（中文）
 * - 所有读写都以 `plugin_name + resource_id` 定位唯一 Resource。
 * - 完整 Resource Item 在写入前按当前 Catalog Schema 校验。
 * - 被 Agent Binding 引用的 Resource 不允许删除，避免产生悬空引用。
 */

import { withPlatformStore } from "@/city/runtime/store/index.js";
import {
  get_plugin_resource_row,
  list_plugin_resource_rows,
  remove_plugin_resource_row,
  set_plugin_resource_row,
} from "@/city/runtime/store/StorePluginResourceRepository.js";
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
  const resources = withPlatformStore((context) =>
    list_plugin_resource_rows(context, plugin_name)
  );
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
  return withPlatformStore((context) =>
    list_plugin_resource_rows(context, plugin_name)
  );
}

/** 读取一个 Plugin Resource。 */
export function get_plugin_resource(
  plugin_name_input: string,
  resource_id_input: string,
): PluginResourceRecord | null {
  const plugin_name = require_resource_plugin(plugin_name_input).plugin_name;
  const resource_id = normalize_resource_id(resource_id_input);
  return withPlatformStore((context) =>
    get_plugin_resource_row(context, plugin_name, resource_id)
  );
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
  const existing = withPlatformStore((context) =>
    get_plugin_resource_row(context, plugin.plugin_name, resource_id)
  );
  const current_time = new Date().toISOString();
  const resource: PluginResourceRecord = {
    plugin_name: plugin.plugin_name,
    resource_id,
    item: input.item,
    created_at: existing?.created_at ?? current_time,
    updated_at: current_time,
  };
  withPlatformStore((context) => set_plugin_resource_row(context, resource));
  return resource;
}

/** 删除一个没有被任何 Agent Binding 引用的 Plugin Resource。 */
export function remove_plugin_resource(
  plugin_name_input: string,
  resource_id_input: string,
): void {
  const plugin_name = require_resource_plugin(plugin_name_input).plugin_name;
  const resource_id = normalize_resource_id(resource_id_input);
  withPlatformStore((context) => {
    const rows = context.sqlite.prepare(`
      SELECT agent_id, resource_ids_json
      FROM agent_plugins
      WHERE plugin_name = ?;
    `).all(plugin_name) as Array<{ agent_id: string; resource_ids_json: string }>;
    const reference = rows.find((row) => parse_resource_ids(row.resource_ids_json).includes(resource_id));
    if (reference) {
      throw new Error(
        `Plugin Resource is still bound to agent ${reference.agent_id}: ${resource_id}`,
      );
    }
    remove_plugin_resource_row(context, plugin_name, resource_id);
  });
}

/** 规范化 Plugin 范围内的 Resource ID。 */
export function normalize_resource_id(input: string): string {
  const resource_id = String(input || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/u.test(resource_id)) {
    throw new Error(`Invalid Plugin Resource id: ${input}`);
  }
  return resource_id;
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

/** 读取去重后的 Resource ID 数组。 */
function parse_resource_ids(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((item) => String(item || "").trim()).filter(Boolean))];
  } catch {
    return [];
  }
}
