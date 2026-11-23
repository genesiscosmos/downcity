/**
 * 官方服务 API 文档的 JSON Schema 小型构建函数。
 * 仅组合静态公开契约，不参与请求校验，也不读取配置或执行业务。
 */
import type { ApiSchema } from "@downcity/downtown";

/** 对象字段与必填集合；省略必填集合时全部字段必填。 */
export function object_schema(properties: Record<string, ApiSchema>, required = Object.keys(properties)): ApiSchema {
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}
/** 包装数组。 */
export function array_schema(items: ApiSchema): ApiSchema { return { type: "array", items }; }
/** 常见的 items 响应包装。 */
export function items_schema(items: ApiSchema): ApiSchema { return object_schema({ items: array_schema(items) }); }
/** 可空字段。 */
export function nullable_schema(schema: ApiSchema): ApiSchema { return { anyOf: [schema, { type: "null" }] }; }
/** 描述具名的字符串字段。 */
export function text_schema(description: string): ApiSchema { return { type: "string", description }; }
/** 枚举字符串。 */
export function enum_schema(...values: string[]): ApiSchema { return { type: "string", enum: values }; }
/** 数值字段；计数与时长由具体端点补充约束。 */
export const number_schema: ApiSchema = { type: "number" };
/** 布尔字段。 */
export const boolean_schema: ApiSchema = { type: "boolean" };
/** ISO 时间；部分持久化协议允许空字符串，调用方需参照字段说明。 */
export const time_schema: ApiSchema = { type: "string", description: "ISO 8601 timestamp; empty where documented as not yet completed" };
/** 业务明确允许任意字段的 JSON 元数据。 */
export const metadata_schema: ApiSchema = { type: "object", additionalProperties: true, description: "Application-defined JSON metadata" };
