/** Desktop MainView 的页面框架与统一 Header。 */

import { createContext, useContext, type ReactNode } from "react";
import { motion } from "framer-motion";
import { MainView, use_baybar_chrome } from "./BayBar";
import { get_collapsed_header_inset, SHELL_MAIN_VIEW_BAND_HEIGHT, SHELL_MAIN_VIEW_BAND_PADDING_BOTTOM, SHELL_PANEL_TRANSITION } from "./shellMotion";

/** 左侧 Sidebar 的折叠状态；右侧 BayBar 由 MainView 自己管理，Shell 不需要知道。 */
interface ShellLayoutControls {
  /** 全局 Sidebar 是否折叠，用于为左上角 Shell 控制预留空间。 */
  sidebar_collapsed: boolean;
}

const shell_layout_context = createContext<ShellLayoutControls | undefined>(undefined);

/** 向 MainView 提供左侧 Sidebar 状态。 */
export function ShellLayoutProvider({ value, children }: {
  /** Shell 布局状态。 */
  value: ShellLayoutControls;
  /** MainView 内容。 */
  children: ReactNode;
}) {
  return <shell_layout_context.Provider value={value}>{children}</shell_layout_context.Provider>;
}

/** 读取 Shell 布局状态；不在 Shell 内时为空。 */
export function use_shell_layout(): ShellLayoutControls | undefined {
  return useContext(shell_layout_context);
}

/**
 * 没有右侧面板的 MainView。
 *
 * 与带 BayBar 的 MainView 共用同一张卡片外壳，保证所有页面视觉一致。
 */
export function MainViewLayout({ children }: { /** 页面 Header 与 Body。 */ children: ReactNode }) {
  return <MainView>{() => children}</MainView>;
}

/** MainView 顶部固定区域，展示页面身份、窗口拖拽空间与页面操作。 */
export function MainViewHeader({ title, left_actions, right_actions, bordered = false }: {
  /** 当前页面身份与上下文。 */
  title?: ReactNode;
  /** 页面级左侧操作。 */
  left_actions?: ReactNode;
  /** 页面级右侧操作。 */ right_actions?: ReactNode;
  /** 是否显示底部分隔线。 */
  bordered?: boolean;
}) {
  const controls = use_shell_layout();
  const chrome = use_baybar_chrome();
  const collapsed_inset = get_collapsed_header_inset();
  // 两侧各自单独判断，避免依赖可选链的类型收窄。
  const sidebar_reserved = Boolean(controls?.sidebar_collapsed);
  const baybar_reserved = chrome.reserved;

  // 卡片内顶栏：高度与底部内边距均由基准线推导，保证内容与侧栏顶栏同处一线。
  return <header className={`flex w-full flex-none items-center bg-background px-2 ${bordered ? "border-b border-border/35" : ""}`} style={{ height: SHELL_MAIN_VIEW_BAND_HEIGHT, paddingBottom: SHELL_MAIN_VIEW_BAND_PADDING_BOTTOM }}>
    {/* 两侧面板折叠后，对应的固定按钮会浮到本 Header 之上，这里各自让出等宽空间；展开时归零。 */}
    <motion.span initial={false} animate={{ width: sidebar_reserved ? collapsed_inset : 0 }} transition={SHELL_PANEL_TRANSITION} className="shrink-0" aria-hidden="true" />
    {left_actions ? <div className="flex shrink-0 items-center gap-1">{left_actions}</div> : null}
    {title ? <div className={`min-w-0 truncate text-xs font-medium text-foreground/80 ${left_actions ? "ml-1" : ""}`}>{title}</div> : null}
    <div className="header-drag-region h-full min-w-0 flex-1" />
    {right_actions ? <div className="ml-1 flex shrink-0 items-center gap-1">{right_actions}</div> : null}
    <motion.span initial={false} animate={{ width: baybar_reserved ? chrome.inset : 0 }} transition={SHELL_PANEL_TRANSITION} className="shrink-0" aria-hidden="true" />
  </header>;
}

/** MainView Header 下方的可增长内容区域。 */
export function MainViewBody({ children }: { /** 页面主要内容。 */ children: ReactNode }) {
  return <div className="flex min-h-0 min-w-0 flex-1">{children}</div>;
}
