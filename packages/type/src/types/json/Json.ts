/**
 * Downcity 跨包 JSON 通用类型定义。
 *
 * 关键点（中文）
 * - 用于约束跨模块传递的可序列化数据结构。
 * - 避免在业务代码中使用宽泛断言，统一采用明确 JSON 类型。
 */

/**
 * JSON 原子值。
 *
 * 说明（中文）
 * - 对应 JSON 规范里的不可再展开标量值。
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * 任意 JSON 值。
 *
 * 说明（中文）
 * - 可为标量、对象或数组。
 */
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

/**
 * JSON 对象。
 *
 * 说明（中文）
 * - key 固定为字符串。
 * - value 继续递归约束为 `JsonValue`。
 */
export type JsonObject = {
  [key: string]: JsonValue;
};
