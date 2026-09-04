/**
 * city agent chat TUI 渲染常量。
 */

/**
 * 消息内容相对角色标题的缩进空格数。
 */
export const MESSAGE_INDENT = "  ";

/**
 * 界面左右边距（列数）。
 * 与 Kimi Code 的 CHROME_GUTTER 保持一致。
 */
export const CHROME_GUTTER = 1;

/**
 * tool 结果折叠时默认预览行数。
 * 对齐 Kimi Code 的 RESULT_PREVIEW_LINES。
 */
export const RESULT_PREVIEW_LINES = 3;

/**
 * 工作中 braille 动画帧。
 * 与 Kimi Code 的 BRAILLE_SPINNER_FRAMES 保持一致。
 */
export const BRAILLE_SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;

/**
 * braille 动画帧切换间隔（毫秒）。
 * 与 Kimi Code 的 BRAILLE_SPINNER_INTERVAL_MS 保持一致。
 */
export const BRAILLE_SPINNER_INTERVAL_MS = 80;

/**
 * 列表选择器默认最大可见项数。
 */
export const DEFAULT_SELECT_MAX_VISIBLE = 6;

/**
 * 会话选择器每页大小。
 */
export const SESSION_PICKER_PAGE_SIZE = 5;

/**
 * 会话选择器最大可见行数。
 */
export const SESSION_PICKER_MAX_VISIBLE = 5;
