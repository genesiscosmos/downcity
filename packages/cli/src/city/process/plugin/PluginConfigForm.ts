/**
 * 标准 JSON Schema 驱动的 Plugin 配置 TUI。
 *
 * 关键点（中文）
 * - 递归处理 object、boolean、number、string、enum、array 与判别式 oneOf。
 * - `readOnly`、`writeOnly` 和 `const` 直接遵循标准 JSON Schema 语义。
 * - 全部编辑先写入草稿，最终 Schema 校验通过后才由调用方持久化。
 */

import prompts from "@/city/tui/Prompts.js";
import { validate_local_plugin_config } from "@downcity/local/product";
import type { JsonObject, JsonValue } from "@downcity/agent";
import type { PromptPluginConfigInput } from "@/city/types/plugin/PluginConfigForm.js";

/** 交互编辑 Plugin 完整配置；取消时返回 null。 */
export async function prompt_plugin_config(
  input: PromptPluginConfigInput,
): Promise<JsonObject | null> {
  const draft = clone_json_object(input.current_config);
  const edited = await prompt_object_fields({
    schema: input.schema,
    value: draft,
    path: input.plugin_name,
  });
  if (!edited) return null;
  validate_local_plugin_config(edited, input.schema);
  return edited;
}

/** 递归编辑一个 JSON object。 */
async function prompt_object_fields(input: {
  schema: JsonObject;
  value: JsonObject;
  path: string;
}): Promise<JsonObject | null> {
  const resolved = await resolve_composed_schema(input.schema, input.value, input.path);
  if (!resolved) return null;
  const active_schema = resolved.schema;
  const initial_value = resolved.value;
  const properties = as_json_object(active_schema.properties) ?? {};
  const required = new Set(
    Array.isArray(active_schema.required)
      ? active_schema.required.filter((item): item is string => typeof item === "string")
      : [],
  );
  const result = clone_json_object(initial_value);

  for (const [key, raw_schema] of Object.entries(properties)) {
    const field_schema = as_json_object(raw_schema);
    if (!field_schema) continue;
    const field_path = `${input.path}.${key}`;
    const field_type = resolve_schema_type(field_schema);
    const current_value = result[key];

    if (field_schema.readOnly === true) continue;
    if (resolved.locked_keys.has(key)) continue;
    if (field_schema.const !== undefined) {
      result[key] = field_schema.const as JsonValue;
      continue;
    }

    if (field_type === "object") {
      const action = await prompt_object_action(
        field_schema,
        current_value,
        field_path,
        required.has(key),
      );
      if (action === null) return null;
      if (action === "keep") continue;
      if (action === "clear") {
        delete result[key];
        continue;
      }
      const nested = await prompt_object_fields({
        schema: field_schema,
        value: as_json_object(current_value) ?? {},
        path: field_path,
      });
      if (!nested) return null;
      if (Object.keys(nested).length > 0 || required.has(key)) result[key] = nested;
      else delete result[key];
      continue;
    }

    const next_value = await prompt_scalar_field({
      schema: field_schema,
      current_value,
      path: field_path,
      required: required.has(key),
    });
    if (next_value.cancelled) return null;
    if (next_value.unset) delete result[key];
    else result[key] = next_value.value as JsonValue;
  }
  return result;
}

/** 解析当前对象的判别式 oneOf 分支，并在首次配置时询问分支字段。 */
async function resolve_composed_schema(
  schema: JsonObject,
  value: JsonObject,
  path: string,
): Promise<{ schema: JsonObject; value: JsonObject; locked_keys: Set<string> } | null> {
  if (!Array.isArray(schema.oneOf)) {
    return { schema, value, locked_keys: new Set() };
  }
  const variants = schema.oneOf
    .map((item) => as_json_object(item))
    .filter((item): item is JsonObject => item !== null);
  const variant_for_value = variants.find((variant) => variant_matches_value(variant, value));
  if (variant_for_value) {
    return {
      schema: merge_object_schema(schema, variant_for_value),
      value,
      locked_keys: new Set(),
    };
  }

  const discriminator = find_discriminator(variants);
  if (!discriminator) return { schema, value, locked_keys: new Set() };
  const choices = discriminator.values;
  const discriminator_schema = as_json_object(schema.properties)?.[discriminator.key];
  const discriminator_schema_object = as_json_object(discriminator_schema) ?? {};
  const response = await prompt_enum_field({
    schema: {
      type: "string",
      title: schema_title(discriminator_schema_object, `${path}.${discriminator.key}`),
      ...(schema_description(discriminator_schema_object)
        ? { description: schema_description(discriminator_schema_object) }
        : {}),
      enum: choices,
    },
    current_value: value[discriminator.key],
    path: `${path}.${discriminator.key}`,
    required: true,
  });
  if (response.cancelled || response.unset || response.value === undefined) return null;
  const next_value = { ...value, [discriminator.key]: response.value };
  const selected_variant = variants.find((variant) => variant_matches_value(variant, next_value));
  if (!selected_variant) return null;
  return {
    schema: merge_object_schema(schema, selected_variant),
    value: next_value,
    locked_keys: new Set([discriminator.key]),
  };
}

/** 判断对象是否满足一个带 const 判别字段的 oneOf 分支。 */
function variant_matches_value(variant: JsonObject, value: JsonObject): boolean {
  const properties = as_json_object(variant.properties) ?? {};
  const discriminators = Object.entries(properties)
    .filter(([, item]) => as_json_object(item)?.const !== undefined);
  return discriminators.length > 0
    && discriminators.every(([key, item]) => value[key] === as_json_object(item)?.const);
}

/** 找出多个 oneOf 分支共用的 const 判别字段。 */
function find_discriminator(variants: JsonObject[]): { key: string; values: JsonValue[] } | null {
  const candidates = new Map<string, JsonValue[]>();
  for (const variant of variants) {
    const properties = as_json_object(variant.properties) ?? {};
    for (const [key, item] of Object.entries(properties)) {
      const field = as_json_object(item);
      if (field?.const !== undefined) {
        candidates.set(key, [...(candidates.get(key) ?? []), field.const as JsonValue]);
      }
    }
  }
  for (const [key, values] of candidates) {
    const unique_values = values.filter((value, index) => values.findIndex((item) => Object.is(item, value)) === index);
    if (unique_values.length === variants.length) return { key, values: unique_values };
  }
  return null;
}

/** 合并通用对象 Schema 与选中的 oneOf 分支。 */
function merge_object_schema(base: JsonObject, variant: JsonObject): JsonObject {
  const base_properties = as_json_object(base.properties) ?? {};
  const variant_properties = as_json_object(variant.properties) ?? {};
  const base_required = Array.isArray(base.required) ? base.required.filter((item): item is string => typeof item === "string") : [];
  const variant_required = Array.isArray(variant.required) ? variant.required.filter((item): item is string => typeof item === "string") : [];
  return {
    ...base,
    ...variant,
    properties: { ...base_properties, ...variant_properties },
    required: [...new Set([...base_required, ...variant_required])],
  };
}

/** 询问是否进入、保留或清空嵌套配置对象。 */
async function prompt_object_action(
  schema: JsonObject,
  current_value: JsonValue | undefined,
  path: string,
  required: boolean,
): Promise<"edit" | "keep" | "clear" | null> {
  const has_value = Boolean(as_json_object(current_value));
  const response = await prompts({
    type: "select",
    name: "action",
    message: schema_title(schema, path),
    subtitle: schema_description(schema),
    choices: [
      {
        title: has_value ? "编辑" : "配置",
        description: has_value ? "编辑当前结构化配置" : "进入该配置分组",
        value: "edit",
      },
      ...(has_value
        ? [{ title: "保持不变", description: "保留当前完整配置", value: "keep" }]
        : required
          ? []
          : [{ title: "跳过", description: "不写入该可选配置", value: "keep" }]),
      ...(has_value && !required
        ? [{ title: "清空", description: "删除该配置分组", value: "clear" }]
        : []),
    ],
    initial: has_value ? "keep" : "edit",
  });
  const action = response.action;
  return action === "edit" || action === "keep" || action === "clear" ? action : null;
}

/** 编辑一个非 object 字段。 */
async function prompt_scalar_field(input: {
  schema: JsonObject;
  current_value: JsonValue | undefined;
  path: string;
  required: boolean;
}): Promise<{ cancelled: boolean; unset?: boolean; value?: JsonValue }> {
  if (Array.isArray(input.schema.enum)) return await prompt_enum_field(input);
  const type = resolve_schema_type(input.schema);
  if (type === "boolean") return await prompt_boolean_field(input);
  if (type === "number" || type === "integer") return await prompt_number_field(input);
  if (type === "array") return await prompt_json_field(input);
  return await prompt_text_field(input);
}

/** 编辑枚举字段。 */
async function prompt_enum_field(
  input: Parameters<typeof prompt_scalar_field>[0],
): Promise<{ cancelled: boolean; unset?: boolean; value?: JsonValue }> {
  const values = input.schema.enum as JsonValue[];
  const response = await prompts({
    type: "select",
    name: "value_index",
    message: schema_title(input.schema, input.path),
    subtitle: schema_description(input.schema),
    choices: [
      ...(!input.required
        ? [{ title: "不设置", description: "删除当前值", value: -1 }]
        : []),
      ...values.map((value, index) => ({
        title: String(value),
        description: `写入 ${JSON.stringify(value)}`,
        value: index,
      })),
    ],
    initial: Math.max(-1, values.findIndex((value) => Object.is(value, input.current_value))),
  });
  if (response.value_index === undefined) return { cancelled: true };
  const index = Number(response.value_index);
  return index >= 0
    ? { cancelled: false, value: values[index] }
    : { cancelled: false, unset: true };
}

/** 编辑布尔字段，同时允许可选字段恢复为未设置。 */
async function prompt_boolean_field(
  input: Parameters<typeof prompt_scalar_field>[0],
): Promise<{ cancelled: boolean; unset?: boolean; value?: JsonValue }> {
  const response = await prompts({
    type: "select",
    name: "value",
    message: schema_title(input.schema, input.path),
    subtitle: schema_description(input.schema),
    choices: [
      { title: "启用", description: "写入 true", value: true },
      { title: "禁用", description: "写入 false", value: false },
      ...(!input.required
        ? [{ title: "不设置", description: "使用 Plugin 默认行为", value: "unset" }]
        : []),
    ],
    initial: input.current_value === true
      ? true
      : input.current_value === false
        ? false
        : "unset",
  });
  if (response.value === undefined) return { cancelled: true };
  return response.value === "unset"
    ? { cancelled: false, unset: true }
    : { cancelled: false, value: response.value === true };
}

/** 编辑数值字段。 */
async function prompt_number_field(
  input: Parameters<typeof prompt_scalar_field>[0],
): Promise<{ cancelled: boolean; unset?: boolean; value?: JsonValue }> {
  const response = await prompts({
    type: "text",
    name: "value",
    message: schema_title(input.schema, input.path),
    subtitle: schema_description(input.schema),
    initial: typeof input.current_value === "number" ? String(input.current_value) : "",
    validate: (value) => {
      if (!String(value).trim() && !input.required) return true;
      const number = Number(value);
      if (!Number.isFinite(number)) return "请输入有效数字";
      if (resolve_schema_type(input.schema) === "integer" && !Number.isInteger(number)) {
        return "请输入整数";
      }
      return true;
    },
  });
  if (response.value === undefined) return { cancelled: true };
  const raw = String(response.value).trim();
  return raw ? { cancelled: false, value: Number(raw) } : { cancelled: false, unset: true };
}

/** 编辑字符串字段。 */
async function prompt_text_field(
  input: Parameters<typeof prompt_scalar_field>[0],
): Promise<{ cancelled: boolean; unset?: boolean; value?: JsonValue }> {
  if (input.schema.writeOnly === true) return await prompt_secret_field(input);
  const response = await prompts({
    type: "text",
    name: "value",
    message: schema_title(input.schema, input.path),
    subtitle: schema_description(input.schema),
    initial: typeof input.current_value === "string" ? input.current_value : "",
    validate: (value) => String(value).trim() || !input.required ? true : "该字段不能为空",
  });
  if (response.value === undefined) return { cancelled: true };
  const value = String(response.value).trim();
  return value ? { cancelled: false, value } : { cancelled: false, unset: true };
}

/** 编辑敏感字符串；已有值默认保留且永不回显。 */
async function prompt_secret_field(
  input: Parameters<typeof prompt_scalar_field>[0],
): Promise<{ cancelled: boolean; unset?: boolean; value?: JsonValue }> {
  const current_value = typeof input.current_value === "string"
    ? input.current_value
    : "";
  if (current_value) {
    const action_response = await prompts({
      type: "select",
      name: "action",
      message: schema_title(input.schema, input.path),
      subtitle: "该字段已配置，当前值不会显示。",
      choices: [
        { title: "保持不变", description: "保留当前敏感值", value: "keep" },
        { title: "替换", description: "输入新的敏感值", value: "replace" },
        ...(!input.required
          ? [{ title: "清空", description: "删除当前敏感值", value: "clear" }]
          : []),
      ],
      initial: "keep",
    });
    if (action_response.action === undefined) return { cancelled: true };
    if (action_response.action === "keep") {
      return { cancelled: false, value: current_value };
    }
    if (action_response.action === "clear") {
      return { cancelled: false, unset: true };
    }
  }
  const response = await prompts({
    type: "password",
    name: "value",
    message: schema_title(input.schema, input.path),
    subtitle: schema_description(input.schema),
    validate: (value) => String(value).trim() || !input.required ? true : "该字段不能为空",
  });
  if (response.value === undefined) return { cancelled: true };
  const value = String(response.value).trim();
  return value ? { cancelled: false, value } : { cancelled: false, unset: true };
}

/** 使用 JSON 文本编辑 array 或复杂 Schema。 */
async function prompt_json_field(
  input: Parameters<typeof prompt_scalar_field>[0],
): Promise<{ cancelled: boolean; unset?: boolean; value?: JsonValue }> {
  const response = await prompts({
    type: "text",
    name: "value",
    message: schema_title(input.schema, input.path),
    subtitle: schema_description(input.schema),
    initial: input.current_value === undefined ? "" : JSON.stringify(input.current_value),
    validate: (value) => {
      if (!String(value).trim() && !input.required) return true;
      try {
        JSON.parse(String(value));
        return true;
      } catch {
        return "请输入有效 JSON";
      }
    },
  });
  if (response.value === undefined) return { cancelled: true };
  const raw = String(response.value).trim();
  return raw
    ? { cancelled: false, value: JSON.parse(raw) as JsonValue }
    : { cancelled: false, unset: true };
}

/** 解析表单当前支持的 JSON Schema 类型。 */
function resolve_schema_type(schema: JsonObject): string {
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.type)) {
    return schema.type.find((item) => typeof item === "string" && item !== "null") as string ?? "string";
  }
  if (schema.properties) return "object";
  return "string";
}

/** 读取 Schema 的人类标题。 */
function schema_title(schema: JsonObject, fallback: string): string {
  return typeof schema.title === "string" && schema.title.trim() ? schema.title.trim() : fallback;
}

/** 读取 Schema 的人类说明。 */
function schema_description(schema: JsonObject): string | undefined {
  return typeof schema.description === "string" && schema.description.trim()
    ? schema.description.trim()
    : undefined;
}

/** 把未知 JSON 值收窄为 object。 */
function as_json_object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

/** 深拷贝 JSON object，保证取消表单时不污染事实源。 */
function clone_json_object(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
