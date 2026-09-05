/**
 * Plugin 协议使用的 JSON 数据类型。
 *
 * Mainview 与宿主 action 之间只允许传递 JSON 数据，避免把宿主对象、函数或资源
 * 句柄泄漏进 Renderer 边界。
 */

/** JSON 原子值。 */
export type PluginJsonPrimitive = string | number | boolean | null;

/** 任意 JSON 值。 */
export type PluginJsonValue =
  | PluginJsonPrimitive
  | PluginJsonObject
  | PluginJsonValue[];

/** JSON 对象。 */
export interface PluginJsonObject {
  /** JSON 对象中的递归字段。 */
  [key: string]: PluginJsonValue;
}
