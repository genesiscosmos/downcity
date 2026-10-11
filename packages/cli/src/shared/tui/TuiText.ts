/**
 * 共享 TUI 文本处理工具。
 *
 * 关键点（中文）
 * - pi-tui 组件以 string[] 作为渲染结果，本模块集中处理换行、截断与补齐。
 * - 宽度计算使用 pi-tui 的 visibleWidth，兼容中文与 ANSI 颜色。
 */

import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const ELLIPSIS = "…";

/**
 * 按终端宽度截断文本。
 */
export function tui_truncate(text: string, width: number): string {
  return truncateToWidth(String(text), Math.max(0, width), ELLIPSIS);
}

/**
 * 将任意说明文本压成适合列表单行展示的摘要。
 *
 * 关键点（中文）
 * - prompt description 经常是多行详情，不能直接拼进列表项。
 * - 这里只做排版清洗，不改变业务含义；完整详情仍由底部预览或详情页承载。
 */
export function tui_compact_line(text: string): string {
  return strip_blessed_tags(String(text || ""))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 将文本补齐到指定显示宽度。
 */
export function tui_pad_end(text: string, width: number): string {
  const value = tui_truncate(text, width);
  const padding = Math.max(0, width - visibleWidth(value));
  return `${value}${" ".repeat(padding)}`;
}

/**
 * 包装多行文本。
 */
export function tui_wrap_lines(text: string, width: number): string[] {
  const safe_width = Math.max(1, width);
  const source_lines = strip_blessed_tags(String(text || "")).split(/\r?\n/);
  const lines: string[] = [];

  for (const source_line of source_lines) {
    if (!source_line) {
      lines.push("");
      continue;
    }
    const wrapped = wrapTextWithAnsi(source_line, safe_width);
    lines.push(...(wrapped.length > 0 ? wrapped : [""]));
  }

  return lines;
}

function strip_blessed_tags(text: string): string {
  return text
    .replace(/\{\/?(bold|underline|red-fg|green-fg|cyan-fg|yellow-fg|blue-fg|magenta-fg|white-fg|gray-fg)\}/g, "")
    .replace(/\{\/?[^}]+\}/g, "");
}

/**
 * 截取一个可滚动视口。
 */
export function tui_viewport(lines: string[], height: number, scroll_offset: number): string[] {
  const safe_height = Math.max(0, height);
  if (safe_height <= 0) return [];
  if (lines.length <= safe_height) return lines;
  const max_offset = Math.max(0, lines.length - safe_height);
  const offset = Math.max(0, Math.min(max_offset, scroll_offset));
  return lines.slice(offset, offset + safe_height);
}

/**
 * 计算全屏 TUI 内容区可用高度。
 *
 * 关键点（中文）
 * - pi-tui 在普通滚动缓冲区里做差分渲染，内容刚好顶满终端时容易触发底部滚屏。
 * - 这里统一预留 1 行安全空间，让重绘不会把旧帧持续推到下方。
 */
export function tui_safe_body_height(reserved_rows: number): number {
  const terminal_rows = process.stdout.rows || Number(process.env.LINES) || 24;
  return Math.max(1, terminal_rows - reserved_rows);
}

/**
 * 计算全屏 TUI 的安全渲染宽度。
 *
 * 关键点（中文）
 * - 终端最后一列容易触发自动换行，导致差分渲染把旧帧向下推。
 * - 全屏组件统一少占 1 列，让每一行都不会写到最右边界。
 */
export function tui_safe_render_width(width: number, minimum_width = 1): number {
  const safe_width = Math.max(1, width) - 1;
  return Math.max(minimum_width, safe_width);
}

/**
 * 计算稳定列表视口的滚动位置。
 *
 * 关键点（中文）
 * - 只有选中项离开当前可见范围时才移动视口，避免上下选择时列表整体晃动。
 * - 调用方可持有 scroll_offset，让下一次渲染延续当前窗口位置。
 */
export function resolve_tui_visible_scroll(input: {
  /** 当前选中的完整列表索引。 */
  selected_index: number;
  /** 当前列表视口起始索引。 */
  scroll_offset: number;
  /** 视口可显示的列表行数。 */
  viewport_height: number;
  /** 完整列表项数量。 */
  item_count: number;
}): number {
  const viewport_height = Math.max(1, input.viewport_height);
  const item_count = Math.max(0, input.item_count);
  if (item_count <= viewport_height) return 0;

  const max_scroll = Math.max(0, item_count - viewport_height);
  let scroll_offset = Math.max(0, Math.min(input.scroll_offset, max_scroll));

  if (input.selected_index < scroll_offset) {
    scroll_offset = input.selected_index;
  } else if (input.selected_index >= scroll_offset + viewport_height) {
    scroll_offset = input.selected_index - viewport_height + 1;
  }

  return Math.max(0, Math.min(scroll_offset, max_scroll));
}
