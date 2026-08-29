/** Agent、Group 等对话页面共用的主视图容器。 */

import type { ReactNode } from "react";
import { MainViewBody, MainViewLayout } from "./MainViewLayout";

/** 统一 Chat Surface 的 Header 与可增长 Body 边界。 */
export function ChatSurfaceLayout({ header_left, header_right, children }: { /** Header 左侧稳定上下文。 */ header_left: ReactNode; /** Header 右侧固定操作组。 */ header_right?: ReactNode; /** 对话主体。 */ children: ReactNode }) {
  return <MainViewLayout><header className="flex h-10 w-full flex-none items-center gap-2 border-b border-border/35 bg-background px-2"><div className="flex min-w-0 items-center gap-1">{header_left}</div><div className="header-drag-region h-full min-w-0 flex-1" />{header_right ? <div className="flex shrink-0 items-center gap-1">{header_right}</div> : null}</header><MainViewBody>{children}</MainViewBody></MainViewLayout>;
}
