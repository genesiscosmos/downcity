/** Plugin profile 按 JSON Schema `writeOnly` 递归脱敏。 */

import type { JsonObject, JsonValue } from "@downcity/agent";

/** 返回不含明文凭据的 profile 副本。 */
export function redact_plugin_config(
  value: JsonValue,
  schema: JsonObject | undefined,
): JsonValue {
  if (!schema) return clone_json_value(value);
  if (schema.writeOnly === true) return "[REDACTED]";
  const selected_schema = select_value_schema(value, schema);
  if (Array.isArray(value)) {
    const item_schema = as_json_object(selected_schema.items);
    return value.map((item) => redact_plugin_config(item, item_schema ?? undefined));
  }
  const object_value = as_json_object(value);
  if (!object_value) return clone_json_value(value);
  const properties = as_json_object(selected_schema.properties) ?? {};
  return Object.fromEntries(Object.entries(object_value).map(([key, item]) => [
    key,
    redact_plugin_config(item, as_json_object(properties[key]) ?? undefined),
  ]));
}

/** 根据对象判别字段选择 oneOf 分支。 */
function select_value_schema(value: JsonValue, schema: JsonObject): JsonObject {
  if (!Array.isArray(schema.oneOf)) return schema;
  const object_value = as_json_object(value);
  if (!object_value) return schema;
  for (const candidate of schema.oneOf) {
    const variant = as_json_object(candidate);
    const properties = as_json_object(variant?.properties);
    if (!variant || !properties) continue;
    const matches = Object.entries(properties).every(([key, field]) => {
      const field_schema = as_json_object(field);
      return field_schema?.const === undefined || object_value[key] === field_schema.const;
    });
    if (matches) return variant;
  }
  return schema;
}

function as_json_object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function clone_json_value(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
