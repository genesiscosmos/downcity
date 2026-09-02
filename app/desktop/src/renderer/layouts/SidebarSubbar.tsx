/**
 * Desktop Shell 的二级 Sidebar 宿主。
 *
 * 关键说明（中文）
 * - Subbar 的布局位置由 Shell 唯一拥有，业务页面只投放当前上下文内容。
 * - 宽度与业务折叠状态由具体 Subbar 管理，全局 Sidebar 折叠时仅临时隐藏。
 * - Portal 保证 Chat 与 Plugin 不需要反向依赖根应用的导航状态。
 */

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { TbChevronLeft, TbChevronRight } from "react-icons/tb";
import { use_horizontal_resize } from "@/hooks/use_horizontal_resize";

const subbar_min_width = 220;
const subbar_max_width = 380;
const subbar_default_width = 272;

/** Shell 向业务视图暴露的最小 Subbar 投放目标。 */
interface SidebarSubbarContextValue {
  /** Portal 挂载节点。 */
  readonly target: HTMLDivElement | null;
  /** 全局 Sidebar 是否折叠。 */
  readonly shell_collapsed: boolean;
}

const sidebar_subbar_context = createContext<SidebarSubbarContextValue>({ target: null, shell_collapsed: false });

/** 在一级 Sidebar 与 MainView 之间提供 Subbar 挂载位置。 */
export function SidebarSubbarProvider({ shell_collapsed, sidebar, children }: {
  /** 全局 Sidebar 是否折叠。 */ readonly shell_collapsed: boolean;
  /** 一级 Sidebar。 */ readonly sidebar: ReactNode;
  /** MainView。 */ readonly children: ReactNode;
}) {
  const [target, set_target] = useState<HTMLDivElement | null>(null);
  return <sidebar_subbar_context.Provider value={{ target, shell_collapsed }}>
    {sidebar}
    <div ref={set_target} className="contents" />
    {children}
  </sidebar_subbar_context.Provider>;
}

/** 把上下文列表渲染到 Shell 的二级 Sidebar，并提供统一宽度与折叠交互。 */
export function SidebarSubbar({ label, storage_key, collapsed, toggle_collapsed, children }: {
  /** Subbar 顶部名称。 */ readonly label: ReactNode;
  /** 持久化宽度使用的稳定键。 */ readonly storage_key: string;
  /** 当前业务 Subbar 是否折叠。 */ readonly collapsed: boolean;
  /** 切换业务 Subbar 折叠状态。 */ readonly toggle_collapsed: () => void;
  /** 可独立滚动的列表内容。 */ readonly children: ReactNode;
}) {
  const { target, shell_collapsed } = useContext(sidebar_subbar_context);
  const [stored_width, set_stored_width] = useState(() => Number(localStorage.getItem(`${storage_key}.width`)) || subbar_default_width);
  const handle_width_change = useCallback((width: number) => {
    set_stored_width(width);
    localStorage.setItem(`${storage_key}.width`, String(width));
  }, [storage_key]);
  const { current_width, is_resizing, handle_resize_start } = use_horizontal_resize({
    stored_width,
    min_width: subbar_min_width,
    max_width: subbar_max_width,
    default_width: subbar_default_width,
    on_width_change: handle_width_change,
  });
  if (!target) return null;
  const hidden = collapsed || shell_collapsed;
  return createPortal(<motion.aside
    initial={false}
    animate={{ width: hidden ? 0 : current_width }}
    transition={{ duration: is_resizing ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
    className="relative flex h-full min-h-0 flex-none select-none overflow-visible"
    aria-hidden={hidden}
  >
    {!hidden ? <div className="h-full min-h-0 overflow-hidden border-r border-border/35 bg-muted/45">
      <div className="flex h-full min-h-0 flex-col" style={{ width: current_width }}>
        <div className="flex h-10 shrink-0 items-center gap-2 px-3">
          <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-foreground/75">{label}</span>
        </div>
        <div className="sidebar-body-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2 pt-0">{children}</div>
      </div>
    </div> : null}
    {!shell_collapsed ? <button
      type="button"
      className="absolute -left-5 top-2 z-[95] flex h-6 w-5 items-center justify-center rounded-l-md border border-r-0 border-border/35 bg-muted text-muted-foreground/55 outline-none transition-[background-color,color,border-color] duration-150 hover:border-border/60 hover:bg-interaction-hover hover:text-foreground focus-visible:border-ring/45 focus-visible:bg-interaction-hover focus-visible:text-foreground"
      title={collapsed ? "展开 Subbar" : "折叠 Subbar"}
      aria-label={collapsed ? "展开 Subbar" : "折叠 Subbar"}
      aria-expanded={!collapsed}
      onClick={toggle_collapsed}
    >{collapsed ? <TbChevronRight className="size-3" /> : <TbChevronLeft className="size-3" />}</button> : null}
    {!hidden ? <div onMouseDown={handle_resize_start} className="absolute right-0 top-0 z-10 -mr-[3px] h-full w-1.5 cursor-ew-resize" /> : null}
  </motion.aside>, target);
}
