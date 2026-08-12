/**
 * Bureau ID 领域值边界。
 *
 * `bureau_id` 是 Federation 内部唯一的不透明产品标识。该模块只判断值是否存在，
 * 不执行 trim、前缀拼接、字符替换或任何其它规范化。
 */

/** 判断输入是否为有效的 opaque Bureau ID。 */
export function is_bureau_id(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** 读取必填 Bureau ID，并保持调用方提供的值完全不变。 */
export function require_bureau_id(value: unknown): string {
  if (!is_bureau_id(value)) {
    throw new TypeError("bureau_id is required");
  }
  return value;
}

/** 读取可选 Bureau ID；只有字段缺失时才返回 undefined。 */
export function read_optional_bureau_id(value: unknown): string | undefined {
  return value === undefined ? undefined : require_bureau_id(value);
}
