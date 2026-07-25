/**
 * 对象类型守卫工具模块。
 *
 * 职责说明（中文）
 * - 提供与“普通对象”判断相关的基础守卫函数。
 * - 供配置解析、CLI 输出、深合并等多个领域复用，避免每个模块各写一份。
 * - 这里只处理通用对象判断，不携带任何业务字段语义。
 */

/**
 * 判断一个值是否为普通对象记录。
 *
 * 关键点（中文）
 * - 数组、`null`、函数都不会被视为普通对象。
 * - 当前只要求“可按键遍历的普通对象”，不强制校验原型链来源。
 */
export function is_plain_object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
