/**
 * Desktop Chat 消息行的稳定标识边界。
 *
 * 只负责两件事，两件都不能省：
 * 1. 给每一行一个稳定 DOM 标识，供历史前插后按同一行恢复视口位置。
 * 2. 保持完整消息 DOM 与浏览器查找、文本选择语义。
 *
 * 这里【不要】加 `content-visibility` 一类的离屏布局跳过：离屏行按占位高度记账、
 * 进入视口后再换成真实高度，而行高普遍相差一个数量级，会让用户向上浏览时
 * 反复看到内容被推走又弹回。原因与取舍见 `use_chat_scroll` 顶部注释。
 */

import type { ReactNode } from "react";

/** 保留完整消息 DOM 的消息行容器。 */
export function ChatMessageViewportRow({ row_id, children }: { /** 消息行稳定标识。 */ row_id: string; /** 消息行内容。 */ children: ReactNode }) {
  return <div data-chat-viewport-row={row_id} className="w-full">{children}</div>;
}
