/**
 * 消息内就地布局变化的滚动补偿入口。
 *
 * ## 为什么需要它
 *
 * 消息的执行过程在正文**上方**（canonical 顺序，不可颠倒，见 `AgentMessageContent`）。
 * 展开过程时消息行顶部在文档流里不动，插入的高度全部压在正文前面，正文因此被推下去。
 * 要让正文原地不动、整条消息向上长，必须在提交后把滚动位置下移同样的位移。
 *
 * 而滚动位置由 `use_chat_scroll` 独占：它要登记自己写入的 scrollTop，否则随后触发的
 * scroll 事件会被读成「用户向上浏览」而无声关掉自动跟随。消息层因此不能自己写 scrollTop，
 * 只能通过这个入口把「要保住的元素」交出去。
 *
 * ## 为什么走 context
 *
 * 提供方是 `SessionTimeline`（持有滚动状态），消费方是 `AgentMessage`，中间隔着
 * 消息列表、分段与消息行三层。逐层传 prop 会让每一层都多一个与自身职责无关的参数，
 * 且每一层都要进 memo 比较；这与 `ChatPowerLookup` 处理 Power 事实表的方式一致。
 *
 * ## 缺失时的行为
 *
 * 未注入时空实现：消息仍可展开，只是视口不补偿。草稿页、Group 页或未来的独立渲染器
 * 忘了包它也不会报错。
 */

import { createContext, useContext, type ReactNode } from "react";

/** 未注入时的空实现。 */
function ignore_preserve_request(): void {}

const ChatScrollAnchorContext = createContext<(element: HTMLElement) => void>(ignore_preserve_request);

/** 注入「保持这个元素在视口内的位置」能力。 */
export function ChatScrollAnchorProvider({ preserve_element_position, children }: {
  /** 由 `use_chat_scroll` 提供的补偿入口。 */
  preserve_element_position(element: HTMLElement): void;
  /** 消息渲染内容。 */
  children: ReactNode;
}) {
  return <ChatScrollAnchorContext.Provider value={preserve_element_position}>{children}</ChatScrollAnchorContext.Provider>;
}

/**
 * 读取滚动补偿入口。
 *
 * 调用时机：在**改变布局之前**（也就是点击展开的同一个事件处理里），传入要保住的元素。
 * 补偿在下一次提交后、绘制前生效。
 *
 * 只有需要「保位置」的布局变化才调用它：展开过程要保正文位置，
 * 折叠则故意不调用，让视口自然落到本条 turn 的结果正文上。
 */
export function use_chat_scroll_anchor(): (element: HTMLElement) => void {
  return useContext(ChatScrollAnchorContext);
}
