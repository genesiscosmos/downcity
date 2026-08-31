/**
 * Downcity 模型协议 JSON 类型模块。
 *
 * 该模块定义所有可跨进程传输的结构化值，避免协议依赖运行时对象或第三方类型。
 */

/** Downcity 模型协议允许传输的 JSON 值。 */
export type ModelJsonValue =
  | string
  | number
  | boolean
  | null
  | ModelJsonValue[]
  | { [key: string]: ModelJsonValue };
