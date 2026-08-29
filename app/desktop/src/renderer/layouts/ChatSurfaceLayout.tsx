/** Agent、Group 等对话页面共用的主视图容器。 */

import type { ReactNode } from "react";
import { MainViewBody, MainViewLayout } from "./MainViewLayout";

/** 统一 Chat Surface 的 Header 与可增长 Body 边界。 */
export function ChatSurfaceLayout({ header, children }: { /** 对话 Header。 */ header: ReactNode; /** 对话主体。 */ children: ReactNode }) {
  return <MainViewLayout><header className="header-drag-region flex h-10 w-full flex-none items-center gap-2 px-2 pr-20">{header}</header><MainViewBody>{children}</MainViewBody></MainViewLayout>;
}
