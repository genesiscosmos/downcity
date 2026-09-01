/** 主导航各业务 Sidebar 共用的顶部标题栏。 */

import type { ReactNode } from "react";

/** 渲染统一高度、间距与标题层级的 Sidebar Header。 */
export function SidebarHeader({ title, actions }: {
  /** 当前 Sidebar 的用户可见标题。 */ readonly title: ReactNode;
  /** 可选的右侧操作。 */ readonly actions?: ReactNode;
}) {
  return <div className="flex h-9 shrink-0 items-center gap-2 px-2">
    <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-muted-foreground">{title}</span>
    {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
  </div>;
}
