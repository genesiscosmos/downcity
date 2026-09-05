/** Duobox MainView 的标准页面容器与统一 Header。 */

import { createContext, useContext, type ReactNode } from "react";
import { motion } from "framer-motion";
import { TbMenu2 } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { use_translation } from "@/locales/i18n";
import { SHELL_PANEL_TRANSITION } from "./shellMotion";

/** MainView Header 需要的 Shell 级控制能力。 */
interface MainViewHeaderControls {
  /** 全局 Sidebar 是否折叠，用于 MainView Header 预留 Shell 左上角控制区。 */
  sidebar_collapsed: boolean;
  /** 当前页面是否允许打开 BayBar。 */
  baybar_available: boolean;
  /** BayBar 是否已打开。 */
  baybar_open: boolean;
}

const main_view_header_context = createContext<MainViewHeaderControls | undefined>(undefined);

/** 读取当前 MainView 的 Shell 布局状态。 */
export function use_main_view_header_controls(): MainViewHeaderControls | undefined {
  return useContext(main_view_header_context);
}

/** 向所有 MainView Header 提供唯一的 Shell 控制状态。 */
export function MainViewHeaderProvider({ value, children }: { /** Shell 控制状态。 */ value: MainViewHeaderControls; /** MainView 内容。 */ children: ReactNode }) {
  return <main_view_header_context.Provider value={value}>{children}</main_view_header_context.Provider>;
}

/** 主视图页面框架。 */
export function MainViewLayout({ children }: { /** 页面 Header 与 Body。 */ children: ReactNode }) {
  return <div className="main-view-layout relative flex h-full min-h-0 min-w-0 flex-1 flex-col">{children}</div>;
}

/** MainView 的统一 Header，负责窗口拖拽区以及左右操作槽。 */
export function MainViewHeader({ title, left_actions, left_inset = 0, right_actions, reserve_shell_control = true, bordered = false }: { /** 页面标题。 */ title?: ReactNode; /** 页面级左侧操作。 */ left_actions?: ReactNode; /** 页面左侧固定控件需要的安全空间。 */ left_inset?: number; /** 页面级右侧操作。 */ right_actions?: ReactNode; /** 是否为固定 Shell 按钮预留空间。 */ reserve_shell_control?: boolean; /** 是否显示底部分隔线。 */ bordered?: boolean }) {
  const controls = useContext(main_view_header_context);
  const shell_control_left = navigator.platform.toLowerCase().includes("mac") ? 80 : 8;
  const shell_left_inset = shell_control_left + 24 + 4 - 8;
  const shell_right_inset = controls?.baybar_available && !controls.baybar_open ? 28 : 0;
  return <header className={`flex h-10 w-full flex-none items-center bg-background px-2 ${bordered ? "border-b border-border/35" : ""}`}>
    <motion.span initial={false} animate={{ width: reserve_shell_control && controls?.sidebar_collapsed ? shell_left_inset : 0 }} transition={SHELL_PANEL_TRANSITION} className="shrink-0" aria-hidden="true" />
    {left_inset > 0 ? <span className="shrink-0" style={{ width: left_inset }} aria-hidden="true" /> : null}
    {left_actions ? <div className="flex shrink-0 items-center gap-1">{left_actions}</div> : null}
    {title ? <div className={`min-w-0 truncate text-xs font-medium text-foreground/80 ${left_actions ? "ml-1" : ""}`}>{title}</div> : null}
    <div className="header-drag-region h-full min-w-0 flex-1" />
    {right_actions ? <div className="ml-1 flex shrink-0 items-center gap-1">{right_actions}</div> : null}
    {shell_right_inset > 0 ? <span className="w-7 shrink-0" aria-hidden="true" /> : null}
  </header>;
}

/** Chat Header 中的 Session Sidebar 开关。 */
export function SessionSidebarButton({ collapsed, toggle_collapsed }: { /** Session Sidebar 是否折叠。 */ collapsed: boolean; /** 切换 Session Sidebar。 */ toggle_collapsed(): void }) {
  const translate_navigation = use_translation("navigation");
  const label = translate_navigation(collapsed ? "panels.expand_left" : "panels.collapse_left");
  return <Button size="icon" actived={!collapsed} onClick={toggle_collapsed} title={label} aria-label={label}><TbMenu2 /></Button>;
}

/** 主视图的可增长内容区域。 */
export function MainViewBody({ children }: { /** 页面实际内容。 */ children: ReactNode }) {
  return <div className="flex min-h-0 min-w-0 flex-1">{children}</div>;
}
