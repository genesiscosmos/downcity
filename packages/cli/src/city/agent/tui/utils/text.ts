/**
 * TUI 文本处理工具。
 */

/**
 * 将多行文本压缩为单行。
 *
 * @param text 原始文本。
 * @returns 单行文本。
 */
export function singleLine(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}
