/**
 * Plugin Resource 创建、刷新与 Binding 解析服务。
 *
 * 关键点（中文）
 * - Schema 决定字段所有权：City 写 `id`，用户写普通字段，Resolver 写其他 `readOnly` 字段。
 * - Resolver 输出作为完整动态字段投影原子覆盖，失败时不会产生半配置 Resource。
 * - Agent 启动只按 ID 读取已保存 Item，不隐式执行 Resolver 或修改全局状态。
 */

import { randomBytes } from "node:crypto";
import type { JsonObject, JsonValue } from "@downcity/agent";
import { get_builtin_plugin_catalog_definition } from "@/city/process/plugin/BuiltinPluginCatalog.js";
import { get_plugin_catalog_item } from "@/city/process/plugin/PluginCatalog.js";
import {
  get_plugin_resource,
  normalize_resource_id,
  set_plugin_resource,
} from "@/city/process/registry/PluginResourceRepository.js";
import {
  apply_plugin_resource_resolver_result,
  assert_plugin_resource_user_fields,
  list_plugin_resource_resolver_fields,
  validate_plugin_resource_item,
} from "@/city/process/plugin/PluginResourceSchema.js";
import { load_external_plugin_factory } from "@/city/runtime/plugins/PluginModuleLoader.js";
import type { AgentPluginBinding } from "@/city/types/plugin/AgentPluginBinding.js";
import type {
  PluginResourceItem,
  PluginResourceRecord,
  PluginResourceResolver,
} from "@/city/types/plugin/PluginResource.js";

/** 使用用户字段创建并解析一个完整 Plugin Resource。 */
export async function create_plugin_resource(input: {
  /** 目标 Plugin 名称。 */
  plugin_name: string;

  /** 用户通过 Schema 表单或 JSON 提供的字段。 */
  fields: JsonObject;
}): Promise<PluginResourceRecord> {
  const plugin = get_plugin_catalog_item(input.plugin_name);
  if (!plugin?.resource_schema) {
    throw new Error(`Plugin does not declare Resources: ${input.plugin_name}`);
  }
  assert_plugin_resource_user_fields(input.fields, plugin.resource_schema);
  const resource_type = String(input.fields.type || "").trim();
  const resource_id = generate_unique_resource_id(plugin.plugin_name, resource_type);
  const draft: JsonObject = { ...input.fields, id: resource_id };
  const item = await resolve_complete_resource({
    plugin_name: plugin.plugin_name,
    resource: draft,
    schema: plugin.resource_schema,
  });
  return set_plugin_resource({ plugin_name: plugin.plugin_name, item });
}

/** 使用新的用户字段更新 Resource，并重新计算全部 Resolver 字段。 */
export async function update_plugin_resource(input: {
  /** 目标 Plugin 名称。 */
  plugin_name: string;

  /** 目标 Resource ID。 */
  resource_id: string;

  /** 编辑后的完整用户可写字段，未出现的字段会被删除。 */
  fields: JsonObject;
}): Promise<PluginResourceRecord> {
  const plugin = get_plugin_catalog_item(input.plugin_name);
  if (!plugin?.resource_schema) {
    throw new Error(`Plugin does not declare Resources: ${input.plugin_name}`);
  }
  const existing = get_plugin_resource(plugin.plugin_name, input.resource_id);
  if (!existing) throw new Error(`Plugin Resource not found: ${input.resource_id}`);
  assert_plugin_resource_user_fields(input.fields, plugin.resource_schema);
  if (String(input.fields.type || "").trim() !== existing.item.type) {
    throw new Error("Plugin Resource type cannot be changed");
  }
  const draft: JsonObject = { ...input.fields, id: existing.resource_id };
  const item = await resolve_complete_resource({
    plugin_name: plugin.plugin_name,
    resource: draft,
    schema: plugin.resource_schema,
  });
  return set_plugin_resource({ plugin_name: plugin.plugin_name, item });
}

/** 不修改用户字段，仅重新计算一个 Resource 的动态字段。 */
export async function refresh_plugin_resource(
  plugin_name: string,
  resource_id: string,
): Promise<PluginResourceRecord> {
  const plugin = get_plugin_catalog_item(plugin_name);
  if (!plugin?.resource_schema) {
    throw new Error(`Plugin does not declare Resources: ${plugin_name}`);
  }
  const existing = get_plugin_resource(plugin.plugin_name, resource_id);
  if (!existing) throw new Error(`Plugin Resource not found: ${resource_id}`);
  const item = await resolve_complete_resource({
    plugin_name: plugin.plugin_name,
    resource: existing.item,
    schema: plugin.resource_schema,
  });
  return set_plugin_resource({ plugin_name: plugin.plugin_name, item });
}

/** 把 Binding 中的 Resource ID 解析为完整 Item 快照。 */
export function resolve_plugin_binding_resources(
  binding: AgentPluginBinding,
  schema: JsonObject | undefined,
): PluginResourceItem[] {
  if (binding.resource_ids.length === 0) return [];
  if (!schema) {
    throw new Error(`Plugin Binding references Resources without a schema: ${binding.plugin_name}`);
  }
  const resources = binding.resource_ids.map((resource_id) => {
    const resource = get_plugin_resource(binding.plugin_name, resource_id);
    if (!resource) {
      throw new Error(
        `Plugin Resource not found: ${binding.plugin_name}/${resource_id}`,
      );
    }
    validate_plugin_resource_item(resource.item, schema);
    return JSON.parse(JSON.stringify(resource.item)) as PluginResourceItem;
  });
  return Object.freeze(
    resources.map((item) => freeze_json_value(item)),
  ) as PluginResourceItem[];
}

/** 执行可选 Resolver 并校验最终完整 Item。 */
async function resolve_complete_resource(input: {
  /** Plugin 名称。 */
  plugin_name: string;

  /** Resolver 执行前的 Resource 草稿。 */
  resource: JsonObject;

  /** 完整 Resource Item Schema。 */
  schema: JsonObject;
}): Promise<PluginResourceItem> {
  const resource_type = String(input.resource.type || "").trim();
  const resolver_fields = list_plugin_resource_resolver_fields(
    input.schema,
    resource_type,
  );
  const resolver = await get_plugin_resource_resolver(input.plugin_name);
  if (!resolver) {
    if (resolver_fields.length > 0) {
      throw new Error(`Plugin Resource Resolver is required: ${input.plugin_name}`);
    }
    validate_plugin_resource_item(input.resource, input.schema);
    return input.resource;
  }
  const resolved_fields = await resolver({
    resource: JSON.parse(JSON.stringify(input.resource)) as JsonObject,
  });
  return apply_plugin_resource_resolver_result({
    resource: input.resource,
    resolved_fields,
    schema: input.schema,
  });
}

/** 读取内建或第三方 Plugin 声明的 Resource Resolver。 */
async function get_plugin_resource_resolver(
  plugin_name: string,
): Promise<PluginResourceResolver | undefined> {
  const builtin = get_builtin_plugin_catalog_definition(plugin_name);
  if (builtin) return builtin.resolve_resource;
  const factory = await load_external_plugin_factory(plugin_name);
  return factory.resolve_resource;
}

/** 生成不依赖可变 name 的稳定 Resource ID。 */
function generate_resource_id(resource_type: string): string {
  const normalized_type = normalize_resource_id(resource_type).slice(0, 48);
  return `${normalized_type}-${randomBytes(5).toString("hex")}`;
}

/** 在 Plugin 范围内生成并确认一个未被占用的 Resource ID。 */
function generate_unique_resource_id(plugin_name: string, resource_type: string): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const resource_id = generate_resource_id(resource_type);
    if (!get_plugin_resource(plugin_name, resource_id)) return resource_id;
  }
  throw new Error(`Unable to allocate Plugin Resource id: ${plugin_name}/${resource_type}`);
}

/** 递归冻结 Resource JSON 快照，避免 Factory 修改同一次装配中的共享值。 */
function freeze_json_value<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) freeze_json_value(item);
    return Object.freeze(value) as T;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze_json_value(item);
    return Object.freeze(value) as T;
  }
  return value;
}
