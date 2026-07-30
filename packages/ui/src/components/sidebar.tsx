/**
 * Downcity Sidebar 三段式布局原语。
 *
 * 关键说明（中文）
 * - Header 与 Footer 固定，Body 独立滚动。
 * - 不拥有导航状态或业务数据。
 */

import { cn } from "../lib/utils";
import type { DowncitySidebarLayoutProps } from "../types/components";

function SidebarLayout({ header, children, footer, className }: DowncitySidebarLayoutProps) {
  return (
    <aside className={cn("flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-sidebar text-sidebar-foreground", className)}>
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer}
    </aside>
  );
}

export { SidebarLayout };
