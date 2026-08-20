/** Plugin JSON Schema 配置协议的统一校验实现。 */

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import formats_plugin from "ajv-formats";
import type { JsonObject, JsonValue } from "@downcity/agent";

const plugin_config_ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
});

const local_write_only_placeholder = "[DOWNCITY_WRITE_ONLY]";

// `x_downcity` 只承载表单展示提示，不参与配置值校验。
plugin_config_ajv.addKeyword({
  keyword: "x_downcity",
  schemaType: "object",
  valid: true,
});

(formats_plugin as unknown as (ajv: Ajv2020) => Ajv2020)(plugin_config_ajv);

/** 校验 `plugin.json` 声明的配置 JSON Schema。 */
export function validate_local_plugin_config_schema(schema: JsonObject): void {
  const valid = plugin_config_ajv.validateSchema(schema);
  if (!valid) {
    throw new Error(`Invalid Plugin config schema: ${format_ajv_errors(
      plugin_config_ajv.errors,
      "config",
    )}`);
  }
  compile_plugin_config_schema(schema);
}

/** 使用 Plugin JSON Schema 校验一个完整 profile。 */
export function validate_local_plugin_config(
  config: JsonObject,
  schema: JsonObject | undefined,
  label = "Plugin config",
): void {
  if (!schema) return;
  const validate = compile_plugin_config_schema(schema);
  if (validate(config)) return;
  throw new Error(`Invalid ${label}: ${format_ajv_errors(validate.errors, label)}`);
}

/** 判断 Schema 是否允许 Plugin 在没有显式 profile 时使用空配置。 */
export function accepts_empty_local_plugin_config(schema: JsonObject): boolean {
  return Boolean(compile_plugin_config_schema(schema)({}));
}

/**
 * 从 Schema 的 `default` 与 `const` 注解创建新 profile 草稿。
 *
 * 该函数只初始化管理表单，不参与运行时缺省值合并；Agent 未选择 profile 时仍然
 * 向 setup 传入原始空对象。
 */
export function create_local_plugin_config_draft(schema: JsonObject): JsonObject {
  const draft = create_schema_default_value(schema);
  return is_json_object(draft) ? draft : {};
}

/** 使用固定占位符替换 `writeOnly` 值，供不可信展示层读取配置。 */
export function redact_local_plugin_write_only_values(
  config: JsonObject,
  schema: JsonObject,
): JsonObject {
  return omit_schema_write_only_value(config, schema) as JsonObject;
}

/**
 * 使用已有 profile 补回草稿中未提交的 `writeOnly` 值。
 *
 * Renderer 不接收凭据原文；用户没有重新填写敏感字段时，由可信主进程在校验和
 * 持久化前从当前 profile 恢复该字段。
 */
export function restore_local_plugin_write_only_values(
  draft: JsonObject,
  current: JsonObject,
  schema: JsonObject,
): JsonObject {
  return restore_schema_write_only_value(draft, current, schema) as JsonObject;
}

/** 编译 Plugin 配置 Schema，并统一包装非法 Schema 错误。 */
function compile_plugin_config_schema(schema: JsonObject): ValidateFunction {
  try {
    return plugin_config_ajv.compile(schema);
  } catch (error) {
    throw new Error(
      `Invalid Plugin config schema: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** 递归读取一个 Schema 节点声明的初始值。 */
function create_schema_default_value(schema: JsonObject): JsonValue | undefined {
  if (schema.const !== undefined) return structuredClone(schema.const as JsonValue);
  if (schema.default !== undefined) return structuredClone(schema.default as JsonValue);
  if (schema.type !== "object" || !is_json_object(schema.properties)) return undefined;
  const entries = Object.entries(schema.properties).flatMap(([key, value]) => {
    if (!is_json_object(value)) return [];
    const child_value = create_schema_default_value(value);
    return child_value === undefined ? [] : [[key, child_value] as const];
  });
  return entries.length > 0 ? Object.fromEntries(entries) as JsonObject : undefined;
}

/** 递归删除 writeOnly 值，并按对象判别字段选择 oneOf 分支。 */
function omit_schema_write_only_value(value: JsonValue, schema: JsonObject): JsonValue | undefined {
  if (schema.writeOnly === true) return local_write_only_placeholder;
  const selected_schema = select_value_schema(value, schema);
  if (Array.isArray(value)) {
    const item_schema = is_json_object(selected_schema.items) ? selected_schema.items : {};
    return value.map((item) => omit_schema_write_only_value(item, item_schema) ?? null);
  }
  if (!is_json_object(value)) return structuredClone(value);
  const properties = is_json_object(selected_schema.properties) ? selected_schema.properties : {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    const child_schema = is_json_object(properties[key]) ? properties[key] : {};
    const sanitized = omit_schema_write_only_value(child, child_schema);
    return sanitized === undefined ? [] : [[key, sanitized] as const];
  })) as JsonObject;
}

/** 递归从已有配置补回草稿中缺失的 writeOnly 值。 */
function restore_schema_write_only_value(
  draft: JsonValue | undefined,
  current: JsonValue | undefined,
  schema: JsonObject,
): JsonValue | undefined {
  if (schema.writeOnly === true) {
    if (draft === null) return undefined;
    return draft === undefined || draft === local_write_only_placeholder
      ? structuredClone(current)
      : draft;
  }
  const selected_schema = select_value_schema(draft ?? current ?? null, schema);
  if (Array.isArray(draft)) {
    const current_items = Array.isArray(current) ? current : [];
    const item_schema = is_json_object(selected_schema.items) ? selected_schema.items : {};
    return draft.map((item, index) => restore_schema_write_only_value(
      item,
      find_corresponding_array_item(item, current_items) ?? current_items[index],
      item_schema,
    ) ?? null);
  }
  if (!is_json_object(draft)) return structuredClone(draft);
  const current_object = is_json_object(current) ? current : {};
  const properties = is_json_object(selected_schema.properties) ? selected_schema.properties : {};
  const keys = new Set([...Object.keys(draft), ...Object.keys(properties)]);
  return Object.fromEntries([...keys].flatMap((key) => {
    const child_schema = is_json_object(properties[key]) ? properties[key] : {};
    const restored = restore_schema_write_only_value(draft[key], current_object[key], child_schema);
    return restored === undefined ? [] : [[key, restored] as const];
  })) as JsonObject;
}

/** 优先按稳定 `id` 匹配结构化数组项目，避免删除或排序后补回错误凭据。 */
function find_corresponding_array_item(
  draft: JsonValue,
  current_items: JsonValue[],
): JsonValue | undefined {
  if (!is_json_object(draft) || typeof draft.id !== "string") return undefined;
  return current_items.find((item) => is_json_object(item) && item.id === draft.id);
}

/** 根据对象判别字段选择当前 oneOf 分支。 */
function select_value_schema(value: JsonValue, schema: JsonObject): JsonObject {
  if (!Array.isArray(schema.oneOf) || !is_json_object(value)) return schema;
  for (const candidate of schema.oneOf) {
    if (!is_json_object(candidate) || !is_json_object(candidate.properties)) continue;
    const matches = Object.entries(candidate.properties).every(([key, field]) => {
      return !is_json_object(field) || field.const === undefined || value[key] === field.const;
    });
    if (matches) return candidate;
  }
  return schema;
}

/** 判断未知值是否为 JSON object。 */
function is_json_object(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 把 Ajv 结构化错误收敛为稳定文本。 */
function format_ajv_errors(
  errors: ErrorObject[] | null | undefined,
  label: string,
): string {
  if (!errors || errors.length === 0) return "unknown validation error";
  const root_label = label === "Plugin config" ? "config" : label;
  return errors
    .map((error) => {
      const path = error.instancePath ? `${root_label}${error.instancePath}` : root_label;
      return `${path} ${error.message || error.keyword}`;
    })
    .join("; ");
}
