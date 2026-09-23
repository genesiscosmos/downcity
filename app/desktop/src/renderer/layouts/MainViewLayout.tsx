/** Desktop MainView 卡片的页面框架、统一 Header 与正文列。 */

import { createContext, useContext, type ReactNode } from "react";
import { shell_collapsed_header_inset_css, SHELL_BAYBAR_COLLAPSED_HEADER_RESERVE_CSS, SHELL_HEADER_HEIGHT_CSS } from "./shellMotion";

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
 * MainView：正文区本身，不是一张卡片。
 *
 * 没有圆角、没有边框、没有留白：面板内缘就是它的边缘。
 * 它只提供三件东西：纵向 flex 容器、内容面的底色、以及撑满正文区的能力。
 * 与面板的分层靠底色差（面板 bg-muted / 正文 bg-background），不靠描边与圆角。
 *
 * 这里不写 min-width：它是 flex 项，自己写只能让它溢出、撑不开父层，
 * 正文下限必须落在行内的 main 上（见 DesktopShell）。两处同时写会让「谁在限制」无法回答。
 */
export function MainView({ children }: { /** 页面 Header 与正文。 */ children: ReactNode }) {
  return <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">{children}</div>;
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

  // 顶栏：高度与两侧共用同一来源，保证内容与侧栏顶栏同处一线。
  // 必须走 CSS 长度出口（rem），写 px 会在界面缩放后与侧栏顶栏错位。
  return <header className={`flex w-full flex-none items-center bg-background px-2 ${bordered ? "border-b border-divider" : ""}`} style={{ height: SHELL_HEADER_HEIGHT_CSS }}>
    {/* 预留宽度含窗口 chrome 的固定部分（macOS 红绿灯留白），因此用 CSS 长度而非动画数值。 */}
    <span style={{ width: sidebar_reserved ? shell_collapsed_header_inset_css() : 0 }} className="shell-inline-reserve shrink-0" aria-hidden="true" />
    {left_actions ? <div className="flex shrink-0 items-center gap-1">{left_actions}</div> : null}
    {title ? <div className={`min-w-0 truncate text-xs font-medium text-foreground ${left_actions ? "ml-1" : ""}`}>{title}</div> : null}
    <div className="header-drag-region h-full min-w-0 flex-1" />
    {right_actions ? <div className="ml-1 flex shrink-0 items-center gap-1">{right_actions}</div> : null}
    <span style={{ width: baybar_reserved ? SHELL_BAYBAR_COLLAPSED_HEADER_RESERVE_CSS : 0 }} className="shell-inline-reserve shrink-0" aria-hidden="true" />
  </header>;
}

/**
 * MainView Header 下方的可增长内容区：正文列。
 *
 * 它自己就是纵向 flex 列（`min-h-0` + `overflow-hidden`），因此页面不必再套一层
 * 「flex flex-col」的中间容器：内容多段纵向排列时（Chat 的视口 + 输入区、
 * 设置页的分栏）直接作为它的 children 即可，纵向分配由它负责。
 *
 * 纵向超出由内容自己滚动（各页面在自己的滚动容器上声明 overflow-y-auto），
 * 这一层不滚动——Header 与输入区这类固定段必须留在滚动之外。
 */
export function MainViewBody({ children }: { /** 页面主要内容。 */ children: ReactNode }) {
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>;
}
