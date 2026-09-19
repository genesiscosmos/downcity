/** Sidebar 业务 Panel 的统一布局原语。 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { sidebar_content_class_name } from "./sidebarRow";

/** Sidebar Panel 属性。 */
interface SidebarPanelProps {
  /** Panel 的 Header、Toolbar 与 Content。 */
  children: ReactNode;
  /** 业务场景附加样式。 */
  class_name?: string;
}

/** Rail 右侧唯一的业务内容容器。 */
export function SidebarPanel({ children, class_name }: SidebarPanelProps) {
  return <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", class_name)}>{children}</div>;
}

/** Sidebar 可滚动内容属性。 */
interface SidebarContentProps {
  /** 可滚动的业务内容。 */
  children: ReactNode;
  /** 业务场景附加样式；可覆盖默认间距。 */
  class_name?: string;
}

/**
 * 统一 Sidebar Panel 的滚动、尺寸约束与基础间距。
 *
 * 左右内边距取自契约（`sidebar_content_class_name`）而不是写 `px-2`：它是三条文字线的第一段，
 * 写死的话改契约时它不会跟着动，整个侧栏的文字会静默错开。
 */
export function SidebarContent({ children, class_name }: SidebarContentProps) {
  return <div data-sidebar-scrollable="true" className={cn("sidebar-body-scroll min-h-0 flex-1 overflow-y-auto pb-2", sidebar_content_class_name, class_name)}>{children}</div>;
}
