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

/** 「回到最新」提示的展示决策。 */
export interface ChatFollowIndicator {
  /** 是否展示回到最新的入口。 */
  visible: boolean;
  /** 离开底部之后新增的消息数；为 0 时只提示位置，不编造数量。 */
  new_message_count: number;
}

/**
 * 决定是否展示「回到最新」。
 *
 * 用户一旦向上滚动就立即退出自动跟随，且【不会】再有任何视觉反馈——
 * 长输出进行到一半时，用户会以为 Agent 卡住了。因此只要不跟随就给出入口；
 * 只有确实存在新增消息时才附带数量，避免滚动位置与数量说法矛盾。
 */
export function resolve_chat_follow_indicator(following: boolean, baseline_message_count: number, message_count: number): ChatFollowIndicator {
  if (following) return { visible: false, new_message_count: 0 };
  return { visible: true, new_message_count: Math.max(0, message_count - baseline_message_count) };
}
