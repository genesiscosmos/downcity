/** Desktop 左侧 Sidebar 的唯一布局外壳。 */

import { useCallback, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { use_horizontal_resize } from "@/hooks/use_horizontal_resize";
import { SHELL_PANEL_TRANSITION, SHELL_SIDEBAR_DEFAULT_WIDTH, SHELL_SIDEBAR_MAX_WIDTH, SHELL_SIDEBAR_MIN_WIDTH } from "@/layouts/shellMotion";

/** Sidebar 外壳属性。 */
interface SidebarFrameProps {
  /** Sidebar 是否折叠。 */
  collapsed: boolean;
  /** Rail 与当前 Panel。 */
  children: ReactNode;
}

/**
 * 持有 Sidebar 的宽度、折叠动画、窗口拖拽区和调整尺寸能力。
 * 业务 Panel 不应重复实现这些 Shell 级布局规则。
 */
export function SidebarFrame({ collapsed, children }: SidebarFrameProps) {
  const [stored_width, set_stored_width] = useState(() => Number(localStorage.getItem("downcity.sidebar_width")) || SHELL_SIDEBAR_DEFAULT_WIDTH);
  const handle_width_change = useCallback((width: number) => {
    set_stored_width(width);
    localStorage.setItem("downcity.sidebar_width", String(width));
  }, []);
  const { current_width, is_resizing, handle_resize_start } = use_horizontal_resize({
    stored_width,
    min_width: SHELL_SIDEBAR_MIN_WIDTH,
    max_width: SHELL_SIDEBAR_MAX_WIDTH,
    default_width: SHELL_SIDEBAR_DEFAULT_WIDTH,
    on_width_change: handle_width_change,
  });

  return <motion.div
    initial={false}
    animate={{ width: collapsed ? 0 : current_width }}
    transition={{ ...SHELL_PANEL_TRANSITION, duration: is_resizing ? 0 : SHELL_PANEL_TRANSITION.duration }}
    className="flex h-full min-h-0 flex-none select-none overflow-hidden whitespace-nowrap border-r border-border/35 bg-muted"
  >
    <aside className="relative flex h-full min-h-0 flex-col overflow-hidden" style={{ width: current_width }}>
      <div className="header-drag-region h-10 shrink-0" aria-hidden="true" />
      <div className="flex min-h-0 flex-1 overflow-hidden">{children}</div>
      {!collapsed ? <div onMouseDown={handle_resize_start} className="absolute right-0 top-0 z-10 -mr-[3px] h-full w-1.5 cursor-ew-resize" /> : null}
    </aside>
  </motion.div>;
}
