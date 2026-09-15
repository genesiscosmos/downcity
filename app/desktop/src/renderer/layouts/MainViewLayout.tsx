/** Desktop MainView 的页面框架与统一 Header。 */

import { createContext, useContext, type ReactNode } from "react";
import { MainView } from "./BayBar";
import { SHELL_BAYBAR_COLLAPSED_HEADER_RESERVE_CSS, shell_collapsed_header_inset_css, SHELL_MAIN_VIEW_BAND_HEIGHT_CSS, SHELL_MAIN_VIEW_BAND_PADDING_BOTTOM_CSS } from "./shellMotion";

/** 两侧面板的折叠状态；两个面板都是窗口级的一列，与卡片无关。 */
interface ShellLayoutControls {
  /** 左侧 Sidebar 是否折叠，用于为左上角 Shell 控制预留空间。 */
  sidebar_collapsed: boolean;
  /** 右侧 BayBar 是否折叠，用于为右上角 Shell 控制预留空间。 */
  baybar_collapsed: boolean;
}

const shell_layout_context = createContext<ShellLayoutControls | undefined>(undefined);

/** 向 MainView 提供两侧面板的折叠状态。 */
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
 * MainView 卡片：所有页面共用同一张外壳，保证视觉一致。
 *
 * 它不关心右侧面板里显示什么，只需要知道面板收没收起（用于给浮动按钮让位）。
 */
export function MainViewLayout({ children }: { /** 页面 Header 与 Body。 */ children: ReactNode }) {
  return <MainView>{children}</MainView>;
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
  // 两个按钮是窗口级浮动控件，面板收起后会浮在卡片之上，因此卡片顶栏各自让出等宽空间。
  // 展开时对应面板自己占住该位置，预留归零。
  const sidebar_reserved = Boolean(controls?.sidebar_collapsed);
  const baybar_reserved = Boolean(controls?.baybar_collapsed);

  // 卡片内顶栏：高度与底部内边距均由基准线推导，保证内容与侧栏顶栏同处一线。
  // 这里必须是 CSS 长度（rem），写 px 会让界面缩放后与侧栏顶栏错位。
  return <header className={`flex w-full flex-none items-center bg-background px-2 ${bordered ? "border-b border-divider" : ""}`} style={{ height: SHELL_MAIN_VIEW_BAND_HEIGHT_CSS, paddingBottom: SHELL_MAIN_VIEW_BAND_PADDING_BOTTOM_CSS }}>
    {/* 预留宽度含窗口 chrome 的固定部分（macOS 红绿灯留白），因此用 CSS 长度而非动画数值。 */}
    <span style={{ width: sidebar_reserved ? shell_collapsed_header_inset_css() : 0 }} className="shell-inline-reserve shrink-0" aria-hidden="true" />
    {left_actions ? <div className="flex shrink-0 items-center gap-1">{left_actions}</div> : null}
    {title ? <div className={`min-w-0 truncate text-xs font-medium text-foreground ${left_actions ? "ml-1" : ""}`}>{title}</div> : null}
    <div className="header-drag-region h-full min-w-0 flex-1" />
    {right_actions ? <div className="ml-1 flex shrink-0 items-center gap-1">{right_actions}</div> : null}
    <span style={{ width: baybar_reserved ? SHELL_BAYBAR_COLLAPSED_HEADER_RESERVE_CSS : 0 }} className="shell-inline-reserve shrink-0" aria-hidden="true" />
  </header>;
}

/** MainView Header 下方的可增长内容区域。 */
export function MainViewBody({ children }: { /** 页面主要内容。 */ children: ReactNode }) {
  return <div className="flex min-h-0 min-w-0 flex-1">{children}</div>;
}
