/**
 * Plugin JSON Schema 驱动的递归配置表单。
 *
 * 覆盖配置协议实际使用的 object、oneOf、array、enum、const、writeOnly 与基础
 * 标量。可选字段清空后会从配置对象删除；敏感值只显示配置状态，不回显原文。
 */

import { useState } from "react";
import { TbPlus, TbTrash } from "react-icons/tb";
import type { JsonObject, JsonValue } from "@downcity/agent";
import { Button } from "@/components/ui/button";
import type {
  ArrayFieldProps,
  FieldLabelProps,
  PluginConfigFormProps,
  SchemaFieldProps,
  SensitiveFieldProps,
} from "@/types/plugin/PluginConfigForm";

const input_class_name = "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs text-foreground outline-none focus:border-ring";

/** 渲染一份对象根节点的 Plugin 配置。 */
export function PluginConfigForm({ schema, value, on_change }: PluginConfigFormProps) {
  return <SchemaObject schema={schema} value={value} on_change={on_change} />;
}

/** 渲染一个对象 Schema，包括 oneOf 判别联合。 */
function SchemaObject({ schema, value, on_change }: PluginConfigFormProps) {
  const variants = get_schema_variants(schema);
  const active_variant = variants.length > 0 ? find_active_variant(variants, value) ?? variants[0] : undefined;
  const active_schema = active_variant ? merge_object_schema(schema, active_variant) : schema;
  const properties = as_object(active_schema.properties) ?? {};
  const required = new Set(as_string_array(active_schema.required));
  const discriminator = variants.length > 0 ? find_discriminator(variants) : undefined;
  const visible_properties = Object.entries(properties).filter(([, child]) => {
    const child_schema = as_object(child);
    return child_schema && child_schema.readOnly !== true && child_schema.const === undefined;
  });
  const select_variant = (variant_index: number) => {
    const variant = variants[variant_index];
    if (!variant) return;
    const selected_schema = merge_object_schema(schema, variant);
    on_change({
      ...retain_compatible_values(value, selected_schema),
      ...create_schema_draft(selected_schema),
    });
  };

  return <div className="space-y-3">
    {discriminator ? <label className="block">
      <FieldLabel label={schema_title(as_object(properties[discriminator.key]) ?? {}, discriminator.key)} required />
      <select className={input_class_name} value={String(value[discriminator.key] ?? discriminator.values[0] ?? "")} onChange={(event) => select_variant(discriminator.values.findIndex((item) => String(item) === event.target.value))}>
        {discriminator.values.map((item, index) => <option key={`${String(item)}-${index}`} value={String(item)}>{schema_title(variants[index] ?? {}, String(item))}</option>)}
      </select>
    </label> : null}
    {visible_properties.map(([key, raw_schema]) => <SchemaField
      key={key}
      name={key}
      schema={as_object(raw_schema)!}
      value={value[key]}
      required={required.has(key)}
      on_change={(next) => {
        const next_value = { ...value };
        if (next === undefined) delete next_value[key];
        else next_value[key] = next;
        on_change(next_value);
      }}
    />)}
    {visible_properties.length === 0 && !discriminator ? <div className="py-8 text-center text-xs text-muted-foreground">此配置没有可编辑字段</div> : null}
  </div>;
}

/** 按 Schema 类型渲染单个字段。 */
function SchemaField({ name, schema, value, required, on_change }: SchemaFieldProps) {
  const label = schema_title(schema, name);
  const description = typeof schema.description === "string" ? schema.description : "";
  const type = resolve_schema_type(schema, value);
  if (type === "object" || Array.isArray(schema.oneOf)) {
    return <fieldset className="rounded-lg border border-border/60 bg-background p-3">
      <legend className="px-1 text-xs font-medium text-foreground">{label}{required ? <span className="ml-1 text-destructive">*</span> : null}</legend>
      {description ? <p className="mb-2 text-[0.6875rem] leading-4 text-muted-foreground">{description}</p> : null}
      <SchemaObject schema={schema} value={as_object(value) ?? {}} on_change={(next) => on_change(Object.keys(next).length > 0 || required ? next : undefined)} />
    </fieldset>;
  }
  return <div className="block">
    <FieldLabel label={label} description={description} required={required} />
    {type === "array"
      ? <ArrayField schema={schema} value={Array.isArray(value) ? value : []} required={required} on_change={on_change} />
      : <ScalarField schema={schema} value={value} required={required} on_change={on_change} />}
  </div>;
}

/** 渲染字段标题与说明。 */
function FieldLabel({ label, description = "", required }: FieldLabelProps) {
  return <><span className="mb-1 block text-xs font-medium text-foreground">{label}{required ? <span className="ml-1 text-destructive">*</span> : null}</span>{description ? <span className="mb-1.5 block text-[0.6875rem] leading-4 text-muted-foreground">{description}</span> : null}</>;
}

/** 渲染基础标量、枚举与敏感文本。 */
function ScalarField({ schema, value, required, on_change }: Omit<SchemaFieldProps, "name">) {
  const type = resolve_schema_type(schema, value);
  const enum_values = Array.isArray(schema.enum) ? schema.enum as JsonValue[] : [];
  if (schema.writeOnly === true) return <SensitiveField value={value} required={required} on_change={on_change} />;
  if (enum_values.length > 0) return <select className={input_class_name} value={value === undefined ? "" : JSON.stringify(value)} onChange={(event) => on_change(event.target.value ? enum_values.find((item) => JSON.stringify(item) === event.target.value) : undefined)}>
    {!required ? <option value="">不设置</option> : null}
    {enum_values.map((item) => <option key={JSON.stringify(item)} value={JSON.stringify(item)}>{String(item)}</option>)}
  </select>;
  if (type === "boolean") return <select className={input_class_name} value={value === undefined ? "" : String(value)} onChange={(event) => on_change(event.target.value === "" ? undefined : event.target.value === "true")}>
    {!required ? <option value="">不设置</option> : null}<option value="true">是</option><option value="false">否</option>
  </select>;
  if (type === "number" || type === "integer") return <input type="number" step={type === "integer" ? 1 : "any"} min={typeof schema.minimum === "number" ? schema.minimum : undefined} max={typeof schema.maximum === "number" ? schema.maximum : undefined} className={input_class_name} value={typeof value === "number" ? value : ""} onChange={(event) => on_change(event.target.value === "" ? undefined : Number(event.target.value))} />;
  return <input className={input_class_name} value={typeof value === "string" ? value : ""} onChange={(event) => on_change(event.target.value === "" && !required ? undefined : event.target.value)} />;
}

/** 敏感字段保持空白输入；已有值只显示状态，避免凭据回显。 */
function SensitiveField({ value, required, on_change }: SensitiveFieldProps) {
  const [draft, set_draft] = useState("");
  const [preserved_value] = useState(value);
  const configured = typeof value === "string" && value.length > 0;
  return <div className="flex gap-2">
    <input type="password" autoComplete="new-password" className={input_class_name} value={draft} placeholder={configured ? "已配置；留空保持不变" : ""} onChange={(event) => { const next = event.target.value; set_draft(next); on_change(next || preserved_value); }} />
    {configured && !required ? <Button size="icon" title="清除敏感值" aria-label="清除敏感值" onClick={() => { set_draft(""); on_change(null); }}><TbTrash /></Button> : null}
  </div>;
}

/** 渲染结构化数组，支持基础值数组和 oneOf 对象数组。 */
function ArrayField({ schema, value, required, on_change }: ArrayFieldProps) {
  const item_schema = as_object(schema.items) ?? {};
  const variants = get_schema_variants(item_schema);
  const add_item = (variant?: JsonObject) => {
    const active_schema = variant ? merge_object_schema(item_schema, variant) : item_schema;
    const type = resolve_schema_type(active_schema, undefined);
    const initial_value: JsonValue = type === "object" || variants.length > 0
      ? create_schema_draft(active_schema)
      : type === "boolean" ? false : type === "number" || type === "integer" ? 0 : "";
    on_change([...value, initial_value]);
  };
  const update_item = (index: number, next: JsonValue | undefined) => {
    const items = [...value];
    if (next === undefined) items.splice(index, 1);
    else items[index] = next;
    on_change(items.length > 0 || required ? items : undefined);
  };
  return <div className="space-y-2">
    {value.map((item, index) => <div key={index} className="rounded-lg border border-border/60 bg-background p-2.5">
      <div className="mb-2 flex items-center justify-between"><span className="text-[0.6875rem] text-muted-foreground">项目 {index + 1}</span><Button size="icon" title="删除项目" aria-label="删除项目" onClick={() => update_item(index, undefined)}><TbTrash /></Button></div>
      {resolve_schema_type(item_schema, item) === "object" || variants.length > 0
        ? <SchemaObject schema={item_schema} value={as_object(item) ?? {}} on_change={(next) => update_item(index, next)} />
        : <ScalarField schema={item_schema} value={item} required on_change={(next) => update_item(index, next)} />}
    </div>)}
    {variants.length > 0 ? <select className={input_class_name} value="" onChange={(event) => { if (event.target.value !== "") add_item(variants[Number(event.target.value)]); }}>
      <option value="">添加项目…</option>{variants.map((variant, index) => <option key={index} value={index}>{schema_title(variant, `类型 ${index + 1}`)}</option>)}
    </select> : <Button onClick={() => add_item()}><TbPlus />添加项目</Button>}
  </div>;
}

/** 读取 Schema 的 oneOf 对象分支。 */
function get_schema_variants(schema: JsonObject): JsonObject[] {
  return Array.isArray(schema.oneOf) ? schema.oneOf.map(as_object).filter((item): item is JsonObject => Boolean(item)) : [];
}

/** 根据 const 判别字段匹配当前对象分支。 */
function find_active_variant(variants: JsonObject[], value: JsonObject): JsonObject | undefined {
  return variants.find((variant) => {
    const properties = as_object(variant.properties) ?? {};
    const constants = Object.entries(properties).filter(([, field]) => as_object(field)?.const !== undefined);
    return constants.length > 0 && constants.every(([key, field]) => value[key] === as_object(field)?.const);
  });
}

/** 找出 oneOf 分支共用的 const 判别字段。 */
function find_discriminator(variants: JsonObject[]): { key: string; values: JsonValue[] } | undefined {
  const candidates = new Map<string, JsonValue[]>();
  for (const variant of variants) {
    const properties = as_object(variant.properties) ?? {};
    for (const [key, field] of Object.entries(properties)) {
      const field_schema = as_object(field);
      if (field_schema?.const !== undefined) candidates.set(key, [...(candidates.get(key) ?? []), field_schema.const as JsonValue]);
    }
  }
  const result = [...candidates.entries()].find(([, values]) => values.length === variants.length);
  return result ? { key: result[0], values: result[1] } : undefined;
}

/** 合并对象 Schema 的公共字段与选中分支。 */
function merge_object_schema(base: JsonObject, variant: JsonObject): JsonObject {
  return {
    ...base,
    ...variant,
    properties: { ...(as_object(base.properties) ?? {}), ...(as_object(variant.properties) ?? {}) },
    required: [...new Set([...as_string_array(base.required), ...as_string_array(variant.required)])],
  };
}

/** 根据 Schema default、const 与对象字段构造表单初始草稿。 */
function create_schema_draft(schema: JsonObject): JsonObject {
  const properties = as_object(schema.properties) ?? {};
  return Object.fromEntries(Object.entries(properties).flatMap(([key, field]) => {
    const field_schema = as_object(field);
    if (!field_schema) return [];
    if (field_schema.const !== undefined) return [[key, structuredClone(field_schema.const as JsonValue)]];
    if (field_schema.default !== undefined) return [[key, structuredClone(field_schema.default as JsonValue)]];
    return [];
  })) as JsonObject;
}

/** 切换 oneOf 分支时保留新分支仍声明的非敏感字段。 */
function retain_compatible_values(value: JsonObject, schema: JsonObject): JsonObject {
  const properties = as_object(schema.properties) ?? {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => {
    const field_schema = as_object(properties[key]);
    return field_schema && field_schema.writeOnly !== true;
  })) as JsonObject;
}

/** 解析 Schema 节点类型。 */
function resolve_schema_type(schema: JsonObject, value: JsonValue | undefined): string {
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.oneOf)) return "object";
  if (Array.isArray(value)) return "array";
  if (as_object(value)) return "object";
  return value === undefined || value === null ? "string" : typeof value;
}

/** 读取 Schema 标题。 */
function schema_title(schema: JsonObject, fallback: string): string {
  return typeof schema.title === "string" && schema.title.trim() ? schema.title : fallback;
}

/** 判断未知值是否为 JSON 对象。 */
function as_object(value: unknown): JsonObject | undefined {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

/** 读取字符串数组。 */
function as_string_array(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
