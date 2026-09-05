/** Desktop Chat 离屏消息行的浏览器原生渲染隔离边界。 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 保留完整消息 DOM，同时让浏览器跳过离屏静态消息的布局与绘制。 */
export function ChatMessageViewportRow({ row_id, active = false, children }: { /** 消息行稳定标识。 */ row_id: string; /** 当前行是否持续变化，需要始终参与布局。 */ active?: boolean; /** 消息行内容。 */ children: ReactNode }) {
  return <div data-chat-viewport-row={row_id} className={cn("w-full", !active && "chat-message-viewport-row")}>{children}</div>;
}
