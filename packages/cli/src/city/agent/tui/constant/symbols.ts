/**
 * city agent chat TUI 通用符号常量。
 *
 * 完全对齐 Kimi Code 的 DESIGN.md 规范。
 */

/**
 * 列表选中指针。与 Kimi Code DESIGN.md 保持一致：仅一个字符，
 * 由调用方自行决定与文本之间的间距。
 */
export const SELECT_POINTER = "❯";

/**
 * 当前/激活项行尾标记，与 Kimi 保持一致：纯 `← current`，
 * 调用方在前面拼接一个空格保持视觉间距。
 */
export const CURRENT_MARK = "← current";

/**
 * 成功标记。
 */
export const SUCCESS_MARK = "✓ ";

/**
 * 失败标记。
 */
export const FAILURE_MARK = "✗ ";
