/** Duobox MainView 的标准页面容器。 */

import type { ReactNode } from "react";

/** 主视图页面框架。 */
export function MainViewLayout({ children }: { /** 页面 Header 与 Body。 */ children: ReactNode }) {
  return <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">{children}</div>;
}

/** 主视图的可增长内容区域。 */
export function MainViewBody({ children }: { /** 页面实际内容。 */ children: ReactNode }) {
  return <div className="flex min-h-0 min-w-0 flex-1">{children}</div>;
}
