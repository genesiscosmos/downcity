/** Desktop Chat 滚动判定与锚点补偿纯函数。 */

import type { ChatScrollMetrics } from "@/types/ChatScroll";

/** 用户距底部不超过该距离时，后续内容增长继续自动跟随。 */
export const chat_sticky_threshold = 80;

/** 判断消息面板是否仍处于自动跟随底部的范围内。 */
export function is_chat_scroll_sticky(metrics: ChatScrollMetrics): boolean {
  return metrics.scroll_height - metrics.scroll_top - metrics.client_height < chat_sticky_threshold;
}

/** 根据同一消息行前插前后的视口偏移计算新的滚动位置。 */
export function resolve_chat_anchor_scroll_top(scroll_top: number, previous_offset: number, current_offset: number): number {
  return Math.max(0, scroll_top + current_offset - previous_offset);
}
