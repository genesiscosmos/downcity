/**
 * Runtime 通用校验模块。
 *
 * 这个模块放只依赖 JavaScript 运行时的轻量校验函数，避免各业务模块互相复制。
 */

/**
 * 校验非空字符串。
 */
export function assertName(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

/**
 * 校验函数值。
 */
export function assertFunction(value: unknown, label: string): asserts value is (...args: unknown[]) => unknown {
  if (typeof value !== "function") {
    throw new TypeError(`${label} must be a function`);
  }
}

/**
 * 深拷贝配置对象，避免外部继续修改已注册配置。
 */
export function clone<T>(value: T): T {
  return structuredClone(value);
}
