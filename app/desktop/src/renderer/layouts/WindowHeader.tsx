/** Desktop 唯一窗口级 Header，承载跨页面的窗口操作。 */

import type { ReactNode } from "react";

/** 窗口 Header 属性。 */
interface WindowHeaderProps {
  /** 左侧窗口操作。 */
  left_actions: ReactNode;
  /** 右侧全局操作。 */
  right_actions: ReactNode;
  /** 当前是否显示窗口 Header。 */
  visible?: boolean;
}

/** 使用正常布局流承载窗口操作，避免悬浮按钮覆盖页面内容。 */
export function WindowHeader({ left_actions, right_actions, visible = true }: WindowHeaderProps) {
  if (!visible) return null;
  return <header className="flex h-10 w-full shrink-0 items-center gap-2 border-b border-border/35 bg-background px-2"><div className="flex shrink-0 items-center gap-1">{left_actions}</div><div className="header-drag-region h-full min-w-0 flex-1" /><div className="flex shrink-0 items-center gap-1">{right_actions}</div></header>;
}
