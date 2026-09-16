/**
 * Desktop Chat 滚动判定与锚点补偿纯函数。
 *
 * 这里只放可独立测试的判定规则；DOM 生命周期与策略编排在 `use_chat_scroll`。
 */

import type { ChatScrollMetrics } from "@/types/ChatScroll";

/** 用户距底部不超过该距离时，后续内容增长继续自动跟随。 */
export const chat_sticky_threshold = 80;

/**
 * 距底部不超过该距离时，认为「最新内容仍在视口内」，不需要回到最新的入口。
 *
 * 为什么不复用 `chat_sticky_threshold`：两者回答的是不同问题，服务的也是不同对象。
 *
 * - `chat_sticky_threshold` 回答「要不要继续自动跟随」：用户只要有向上浏览的意图就停止跟随
 *   （见 `is_chat_scroll_up_intent`），这个值只用来吸收锚定修正与亚像素抖动，所以要宽容；
 * - 本值回答「要不要给一个回到最新的入口」：只有当最新内容真的滑出视野、回去需要费力时才该出现。
 *
 * 两者相等时，向上滚 81px 就会冒出一个按钮——而视口高数百像素，此时底部内容仍一目了然，
 * 用户会觉得「我明明没走远」。取 3 倍就是为了留出这段滞回区间：跟随在 80px 处停止、
 * 入口在 240px 处出现，中间那一段两者都不抢视线。
 *
 * 写成倍数而不是另一个数字，是为了改一处时两者不会分叉。
 */
export const chat_latest_visible_threshold = chat_sticky_threshold * 3;

/**
 * 构成「用户向上浏览」意图所需的最小位移，单位为 CSS 像素。
 *
 * 浏览器的滚动锚定修正、亚像素取整和容器缩放都会产生不足 1px 的向上位移；
 * 把它们当成用户操作会让自动跟随被无声关闭，因此统一用容差吸收。
 */
export const chat_scroll_intent_tolerance = 1;

/** 判断消息面板是否仍处于自动跟随底部的范围内。 */
export function is_chat_scroll_sticky(metrics: ChatScrollMetrics): boolean {
  return metrics.scroll_height - metrics.scroll_top - metrics.client_height < chat_sticky_threshold;
}

/**
 * 判断一次 scroll 位移是否构成用户的向上浏览意图。
 *
 * 只比较位移量，不关心来源账户；由本模块写入的滚动位置必须先经
 * `is_programmatic_scroll_top` 排除，避免程序化定位被读成用户上滑。
 */
export function is_chat_scroll_up_intent(previous_top: number, next_top: number): boolean {
  return next_top < previous_top - chat_scroll_intent_tolerance;
}

/**
 * 最新内容是否仍在视口内（距底部不超过入口阈值）。
 *
 * 这是「要不要展示回到最新」的唯一依据，与自动跟随是两个独立信号：
 * 自动跟随由用户意图决定，本判定只看距离——内容增长把底部推远时距离会自动变大，
 * 因此新内容一到来就能准确反映，不需要另外记账。
 */
export function is_chat_latest_visible(metrics: ChatScrollMetrics): boolean {
  return metrics.scroll_height - metrics.scroll_top - metrics.client_height < chat_latest_visible_threshold;
}

/** 判断 scroll 事件是否恰好落在本模块上一次写入的滚动位置上。 */
export function is_programmatic_scroll_top(programmatic_top: number | undefined, current_top: number): boolean {
  return programmatic_top !== undefined && Math.abs(current_top - programmatic_top) <= chat_scroll_intent_tolerance;
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
 * 只看**最新内容在不在视野里**，不再看自动跟随状态。
 *
 * 早先的写法是「一退出跟随就伸出入口」，而退出跟随只需要向上滑 1px（那是自动跟随必须的
 * 灵敏度：晚一步就会和用户的滚动抢视口），于是刚离开底部、底部内容还在眼前时按钮就出现了，
 * 而且一旦新内容到来它就一直在——因为它同时兼任了「有新消息」的提示。
 *
 * 把两件事拆开后各自都准了：
 *
 * - 展示条件 = 最新内容已滑出视野（距离阈值，`is_chat_latest_visible`）；
 * - 数量 = 离开底部之后新增的消息数；确实是 0 时只提示位置，不编造数量。
 */
export function resolve_chat_follow_indicator(options: {
  /** 最新内容是否仍在视口内。 */
  latest_visible: boolean;
  /** 离开底部那一刻的消息数；基线由调用方的跟随状态维护。 */
  baseline_message_count: number;
  /** 当前消息数。 */
  message_count: number;
}): ChatFollowIndicator {
  if (options.latest_visible) return { visible: false, new_message_count: 0 };
  // 负数出现在重写历史消息后（消息数变少），此时退回「回到最新」而不是报「-1 条新消息」。
  return { visible: true, new_message_count: Math.max(0, options.message_count - options.baseline_message_count) };
}
