/**
 * Plugin Manifest 配置校验器。
 *
 * 关键点（中文）
 * - City 在 Binding 写入前校验配置，Runtime Factory 只接收已通过校验的 JSON。
 * - 当前支持常用 JSON Schema 子集：type、required、properties、items、enum 与 additionalProperties。
 * - 遇到不认识的约束不会误判，复杂校验可在后续替换为完整 JSON Schema 引擎。
 */

import type { JsonObject, JsonValue } from "@downcity/agent";

/** 按 Manifest JSON Schema 校验 Plugin 配置。 */
export function validate_plugin_config(
  config: JsonObject,
  schema: JsonObject | undefined,
): void {
  if (!schema) return;
  validate_value(config, schema, "config");
}

/** 递归校验单个 JSON 值。 */
function validate_value(value: JsonValue, schema: JsonObject, path: string): void {
  const expected_type = typeof schema.type === "string" ? schema.type : undefined;
  if (expected_type && !matches_type(value, expected_type)) {
    throw new Error(`${path} must be ${expected_type}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => item === value)) {
    throw new Error(`${path} must match one of the declared enum values`);
  }
  if (Array.isArray(value)) {
    const item_schema = as_json_object(schema.items);
    if (item_schema) {
      value.forEach((item, index) => validate_value(item, item_schema, `${path}[${index}]`));
    }
    return;
  }
  const record = as_json_object(value);
  if (!record) return;
  const properties = as_json_object(schema.properties) ?? {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string")
    : [];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new Error(`${path}.${key} is required`);
    }
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(record)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        throw new Error(`${path}.${key} is not allowed`);
      }
    }
  }
  for (const [key, child_value] of Object.entries(record)) {
    const child_schema = as_json_object(properties[key]);
    if (child_schema) validate_value(child_value, child_schema, `${path}.${key}`);
  }
}

/** 判断 JSON 值是否符合声明类型。 */
function matches_type(value: JsonValue, expected_type: string): boolean {
  if (expected_type === "null") return value === null;
  if (expected_type === "array") return Array.isArray(value);
  if (expected_type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (expected_type === "integer") return typeof value === "number" && Number.isInteger(value);
  return typeof value === expected_type;
}

/** 把未知 JSON 值收窄为对象。 */
function as_json_object(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}
