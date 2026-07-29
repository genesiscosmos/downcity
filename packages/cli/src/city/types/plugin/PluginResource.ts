/**
 * City Plugin Resource 领域类型。
 *
 * 关键点（中文）
 * - Resource Item 是由静态 Schema 约束、可由 Resolver 更新部分字段的完整 JSON 对象。
 * - Resource 的事实源属于全局 Plugin Resource Store，Agent Binding 只保存稳定 ID 引用。
 * - `id`、`type`、`name` 是通用展示与解析字段，其余字段完全由 Plugin Schema 定义。
 */

import type { JsonObject } from "@downcity/agent";

/** 一个完整、已解析并可直接传给 Plugin Factory 的 Resource Item。 */
export interface PluginResourceItem extends JsonObject {
  /** CLI 生成且在 Plugin 范围内唯一的稳定 ID。 */
  id: string;

  /** Plugin 定义的 Resource 类型判别字段。 */
  type: string;

  /** CLI 和其他宿主统一展示的 Resource 名称。 */
  name: string;
}

/** Resource Schema 中一个可判别的完整 Item 类型分支。 */
export interface PluginResourceSchemaVariant {
  /** `type.const` 声明的稳定 Resource 类型。 */
  type: string;

  /** Schema 提供给通用 CLI 表单使用的展示标题。 */
  title: string;

  /** 当前 Resource 类型的完整对象 JSON Schema。 */
  schema: JsonObject;
}

/** 全局 Plugin Resource 持久化记录。 */
export interface PluginResourceRecord {
  /** 拥有该 Resource 的 Plugin 名称。 */
  plugin_name: string;

  /** Resource 完整配置中的稳定 ID。 */
  resource_id: string;

  /** 已通过 Resource Schema 校验的完整 Resource Item。 */
  item: PluginResourceItem;

  /** 首次创建时间，使用 ISO 8601 字符串。 */
  created_at: string;

  /** 最近一次完整 Item 更新的时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}

/** Plugin Resource Resolver 输入。 */
export interface ResolvePluginResourceInput {
  /** 包含系统字段、用户字段和已有动态字段的 Resource 草稿。 */
  resource: JsonObject;
}

/** Plugin Resource Resolver。 */
export type PluginResourceResolver = (
  input: ResolvePluginResourceInput,
) => Promise<JsonObject> | JsonObject;

/** 新建或完整替换一个 Resource 的仓储输入。 */
export interface SetPluginResourceInput {
  /** 拥有该 Resource 的 Plugin 名称。 */
  plugin_name: string;

  /** 需要持久化的完整 Resource Item。 */
  item: PluginResourceItem;
}
