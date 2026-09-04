/**
 * 用于 TUI 内部生成稳定的条目 id。
 */

let counter = 0;

/**
 * 生成一个仅在当前 TUI 进程中唯一的字符串 id。
 */
export function generateTuiId(): string {
  counter += 1;
  return `tui_${Date.now().toString(36)}_${counter.toString(36)}`;
}
