/**
 * Agent Chat transcript 导航输入解析器。
 *
 * 统一处理分页键与方向键组合，避免 Coordinator 和 Editor 分别维护互相冲突的
 * 滚动规则。TUI 不启用鼠标追踪，保留终端原生文本框选与复制能力。
 */

import { Key, matchesKey } from "@earendil-works/pi-tui";

/**
 * 将终端输入解析为 transcript 滚动增量。
 *
 * 正数向上查看历史，负数向下返回最新内容；负无穷表示直接回到底部。
 * 无关输入返回 null，继续交给当前焦点组件处理。
 *
 * @param data 单个终端输入序列。
 * @param page_size 当前 transcript 一页可滚动的行数。
 * @returns 滚动增量，或 null。
 */
export function resolve_transcript_scroll_delta(
  data: string,
  page_size: number,
): number | null {
  const safe_page_size = Math.max(1, Math.floor(page_size));
  if (matchesKey(data, Key.pageUp)) return safe_page_size;
  if (matchesKey(data, Key.pageDown)) return -safe_page_size;
  if (matchesKey(data, Key.shift("up"))) return 1;
  if (matchesKey(data, Key.shift("down"))) return -1;
  if (matchesKey(data, Key.ctrl("l"))) return Number.NEGATIVE_INFINITY;

  return null;
}
