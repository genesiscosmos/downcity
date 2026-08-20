/** Desktop Plugin JSON Schema 配置表单类型。 */

import type { JsonObject, JsonValue } from "@downcity/agent";

/** Plugin 配置表单入口属性。 */
export interface PluginConfigFormProps {
  /** Plugin setup 导出的完整 JSON Schema。 */
  schema: JsonObject;
  /** 当前正在编辑的完整配置对象。 */
  value: JsonObject;
  /** 完整配置对象变化回调。 */
  on_change(value: JsonObject): void;
}

/** JSON Schema 单字段渲染属性。 */
export interface SchemaFieldProps {
  /** 字段在父对象内的稳定名称。 */
  name: string;
  /** 当前字段的 JSON Schema。 */
  schema: JsonObject;
  /** 当前字段值；undefined 表示字段未配置。 */
  value: JsonValue | undefined;
  /** 当前字段是否被父对象 Schema 标记为必填。 */
  required: boolean;
  /** 字段变化回调；undefined 表示删除可选字段。 */
  on_change(value: JsonValue | undefined): void;
}

/** 配置字段标题属性。 */
export interface FieldLabelProps {
  /** 用户可见字段标题。 */
  label: string;
  /** 用户可见字段说明。 */
  description?: string;
  /** 当前字段是否必填。 */
  required: boolean;
}

/** 敏感配置字段属性。 */
export interface SensitiveFieldProps {
  /** 脱敏占位符、新值或未设置状态。 */
  value: JsonValue | undefined;
  /** 当前敏感字段是否必填。 */
  required: boolean;
  /** 敏感字段变化回调；null 表示用户显式清除。 */
  on_change(value: JsonValue | undefined): void;
}

/** JSON Schema 数组字段属性。 */
export interface ArrayFieldProps {
  /** 数组字段 JSON Schema。 */
  schema: JsonObject;
  /** 当前数组值。 */
  value: JsonValue[];
  /** 当前数组字段是否必填。 */
  required: boolean;
  /** 数组变化回调；undefined 表示删除可选空数组。 */
  on_change(value: JsonValue[] | undefined): void;
}
