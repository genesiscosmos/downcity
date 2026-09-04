/**
 * Downcity CLI 语言类型定义。
 *
 * 关键说明（中文）
 * - 统一收敛 CLI 可选语言，避免各模块重复声明字面量联合类型。
 * - 当前仅支持中文与英文。
 */

/**
 * Downcity CLI 支持的语言代码。
 */
export type CliLocale =
  /** 中文 */
  | "zh"
  /** 英文 */
  | "en";
