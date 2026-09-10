/** Desktop MainView 的标准页面框架与统一 Header。 */

import { createContext, useContext, type ReactNode } from "react";
import { motion } from "framer-motion";
import { SHELL_PANEL_TRANSITION } from "./shellMotion";

/** MainView Header 需要的唯一 Shell 布局状态。 */
interface MainViewHeaderControls {
  /** 全局 Sidebar 是否折叠，用于为左上角 Shell 控制预留空间。 */
  sidebar_collapsed: boolean;
}

const main_view_header_context = createContext<MainViewHeaderControls | undefined>(undefined);

/** 向 MainView Header 提供全局 Sidebar 状态。 */
export function MainViewHeaderProvider({ value, children }: {
  /** Shell 布局状态。 */
  value: MainViewHeaderControls;
  /** MainView 内容。 */
  children: ReactNode;
}) {
  return <main_view_header_context.Provider value={value}>{children}</main_view_header_context.Provider>;
}

/** MainView 页面框架，由 Header 和 Body 纵向组成。 */
export function MainViewLayout({ children }: { /** 页面 Header 与 Body。 */ children: ReactNode }) {
  return <div className="main-view-layout relative flex h-full min-h-0 min-w-0 flex-1 flex-col">{children}</div>;
}

/** MainView 顶部固定区域，展示页面身份、窗口拖拽空间与页面操作。 */
export function MainViewHeader({ title, left_actions, right_actions, bordered = false }: {
  /** 当前页面身份与上下文。 */
  title?: ReactNode;
  /** 页面级左侧操作。 */
  left_actions?: ReactNode;
  /** 页面级右侧操作。 */
  right_actions?: ReactNode;
  /** 是否显示底部分隔线。 */
  bordered?: boolean;
}) {
  const controls = useContext(main_view_header_context);
  const shell_control_left = navigator.platform.toLowerCase().includes("mac") ? 80 : 8;
  const shell_left_inset = shell_control_left + 24 + 4 - 8;
  return <header className={`flex h-10 w-full flex-none items-center bg-background px-2 ${bordered ? "border-b border-border/35" : ""}`}>
    <motion.span initial={false} animate={{ width: controls?.sidebar_collapsed ? shell_left_inset : 0 }} transition={SHELL_PANEL_TRANSITION} className="shrink-0" aria-hidden="true" />
    {left_actions ? <div className="flex shrink-0 items-center gap-1">{left_actions}</div> : null}
    {title ? <div className={`min-w-0 truncate text-xs font-medium text-foreground/80 ${left_actions ? "ml-1" : ""}`}>{title}</div> : null}
    <div className="header-drag-region h-full min-w-0 flex-1" />
    {right_actions ? <div className="ml-1 flex shrink-0 items-center gap-1">{right_actions}</div> : null}
  </header>;
}

/** MainView Header 下方的可增长内容区域。 */
export function MainViewBody({ children }: { /** 页面主要内容。 */ children: ReactNode }) {
  return <div className="flex min-h-0 min-w-0 flex-1">{children}</div>;
}
