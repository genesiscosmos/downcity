/**
 * Plugin Resource JSON Schema 规则。
 *
 * 关键点（中文）
 * - Resource Schema 描述一个完整 Resource Item，而不是表单草稿或存储引用。
 * - `id` 由 City 写入，其他 `readOnly` 顶层字段只能由 Resolver 写入。
 * - `writeOnly` 只控制交互与输出脱敏，不改变字段在完整 Item 中的存在方式。
 */

import type { JsonObject, JsonValue } from "@downcity/agent";
import { compile_plugin_config_schema, validate_plugin_config_schema } from "@/city/process/plugin/PluginConfigValidator.js";
import type {
  PluginResourceItem,
  PluginResourceSchemaVariant,
} from "@/city/types/plugin/PluginResource.js";

/** 校验 Resource Schema 本身及 City 所需的最小公共字段。 */
export function validate_plugin_resource_schema(schema: JsonObject): void {
  validate_plugin_config_schema(schema);
  const variants = list_plugin_resource_schema_variants(schema);
  if (variants.length === 0) {
    throw new Error("Plugin Resource schema must define an object or oneOf object variants");
  }
  const types = new Set<string>();
  for (const variant of variants) {
    if (types.has(variant.type)) {
      throw new Error(`Plugin Resource schema contains duplicate type: ${variant.type}`);
    }
    types.add(variant.type);
    validate_resource_variant_contract(variant);
  }
}

/** 按完整 Schema 校验一个 Resource Item。 */
export function validate_plugin_resource_item(
  item: JsonObject,
  schema: JsonObject,
): asserts item is PluginResourceItem {
  const validate = compile_plugin_config_schema(schema);
  if (!validate(item)) {
    const details = validate.errors
      ?.map((error) => `${error.instancePath || "resource"} ${error.message || error.keyword}`)
      .join("; ") || "unknown validation error";
    throw new Error(`Invalid Plugin Resource: ${details}`);
  }
  const id = String(item.id || "").trim();
  const type = String(item.type || "").trim();
  const name = String(item.name || "").trim();
  if (!id || !type || !name) {
    throw new Error("Plugin Resource requires non-empty id, type, and name");
  }
}

/** 列出 Schema 中可创建的 Resource 类型。 */
export function list_plugin_resource_schema_variants(
  schema: JsonObject,
): PluginResourceSchemaVariant[] {
  const candidates = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : [schema];
  return candidates.flatMap((candidate) => {
    const object_schema = as_json_object(candidate);
    const properties = as_json_object(object_schema?.properties);
    const type_schema = as_json_object(properties?.type);
    const type = typeof type_schema?.const === "string" ? type_schema.const.trim() : "";
    if (!object_schema || !type) return [];
    return [{
      type,
      title: typeof object_schema.title === "string" && object_schema.title.trim()
        ? object_schema.title.trim()
        : type,
      schema: object_schema,
    }];
  });
}

/** 根据 Resource 的 type 读取对应对象 Schema。 */
export function get_plugin_resource_variant_schema(
  schema: JsonObject,
  resource_type: string,
): JsonObject {
  const variant = list_plugin_resource_schema_variants(schema)
    .find((item) => item.type === resource_type);
  if (!variant) throw new Error(`Unsupported Plugin Resource type: ${resource_type}`);
  return variant.schema;
}

/** 返回当前 Resource 类型全部 Resolver 可写的顶层字段。 */
export function list_plugin_resource_resolver_fields(
  schema: JsonObject,
  resource_type: string,
): string[] {
  const variant = get_plugin_resource_variant_schema(schema, resource_type);
  const properties = as_json_object(variant.properties) ?? {};
  return Object.entries(properties)
    .filter(([key, value]) => key !== "id" && key !== "type" && as_json_object(value)?.readOnly === true)
    .map(([key]) => key);
}

/** 拒绝用户输入 Schema 中的系统或 Resolver 字段。 */
export function assert_plugin_resource_user_fields(
  input: JsonObject,
  schema: JsonObject,
): void {
  const resource_type = String(input.type || "").trim();
  const variant = get_plugin_resource_variant_schema(schema, resource_type);
  const properties = as_json_object(variant.properties) ?? {};
  for (const key of Object.keys(input)) {
    if (key === "id") throw new Error("Plugin Resource id is managed by City");
    if (as_json_object(properties[key])?.readOnly === true) {
      throw new Error(`Plugin Resource field is read-only: ${key}`);
    }
  }
}

/**
 * 用 Resolver 返回值原子替换全部动态字段。
 *
 * 关键点（中文）：Resolver 必须返回当前动态字段的完整投影，未返回的可选字段会被删除。
 */
export function apply_plugin_resource_resolver_result(input: {
  /** Resolver 执行前的完整 Resource 草稿。 */
  resource: JsonObject;

  /** Resolver 返回的动态字段投影。 */
  resolved_fields: JsonObject;

  /** Plugin 的完整 Resource Schema。 */
  schema: JsonObject;
}): PluginResourceItem {
  const resource_type = String(input.resource.type || "").trim();
  const resolver_fields = new Set(
    list_plugin_resource_resolver_fields(input.schema, resource_type),
  );
  for (const key of Object.keys(input.resolved_fields)) {
    if (!resolver_fields.has(key)) {
      throw new Error(`Plugin Resource Resolver cannot write field: ${key}`);
    }
  }
  const result = clone_json_object(input.resource);
  for (const key of resolver_fields) delete result[key];
  Object.assign(result, clone_json_object(input.resolved_fields));
  validate_plugin_resource_item(result, input.schema);
  return result;
}

/** 根据 Schema 递归脱敏全部 `writeOnly` 字段。 */
export function redact_plugin_schema_value(
  value: JsonValue,
  schema: JsonObject | undefined,
): JsonValue {
  if (!schema) return clone_json_value(value);
  if (schema.writeOnly === true) return "[REDACTED]";
  const selected_schema = select_value_schema(value, schema);
  if (Array.isArray(value)) {
    const item_schema = as_json_object(selected_schema.items);
    return value.map((item) =>
      redact_plugin_schema_value(item, item_schema ?? undefined)
    );
  }
  const object_value = as_json_object(value);
  if (!object_value) return clone_json_value(value);
  const properties = as_json_object(selected_schema.properties) ?? {};
  return Object.fromEntries(
    Object.entries(object_value).map(([key, item]) => [
      key,
      redact_plugin_schema_value(
        item,
        as_json_object(properties[key]) ?? undefined,
      ),
    ]),
  );
}

/** 校验单个 Resource 类型分支满足公共协议。 */
function validate_resource_variant_contract(
  variant: PluginResourceSchemaVariant,
): void {
  if (variant.schema.type !== "object") {
    throw new Error(`Plugin Resource variant must be an object: ${variant.type}`);
  }
  const properties = as_json_object(variant.schema.properties) ?? {};
  const required = new Set(
    Array.isArray(variant.schema.required)
      ? variant.schema.required.filter((item): item is string => typeof item === "string")
      : [],
  );
  for (const key of ["id", "type", "name"]) {
    if (!as_json_object(properties[key]) || !required.has(key)) {
      throw new Error(`Plugin Resource variant ${variant.type} must require ${key}`);
    }
  }
  if (as_json_object(properties.id)?.readOnly !== true) {
    throw new Error(`Plugin Resource variant ${variant.type} id must be readOnly`);
  }
  if (variant.schema.additionalProperties !== false) {
    throw new Error(
      `Plugin Resource variant ${variant.type} must set additionalProperties to false`,
    );
  }
}

/** 根据值选择可判别的 oneOf 分支。 */
function select_value_schema(value: JsonValue, schema: JsonObject): JsonObject {
  if (!Array.isArray(schema.oneOf)) return schema;
  const object_value = as_json_object(value);
  const resource_type = typeof object_value?.type === "string" ? object_value.type : "";
  return list_plugin_resource_schema_variants(schema)
    .find((variant) => variant.type === resource_type)?.schema ?? schema;
}

/** 将未知值收窄为普通 JSON object。 */
function as_json_object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

/** 深拷贝 JSON object。 */
function clone_json_object(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

/** 深拷贝 JSON value。 */
function clone_json_value(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
