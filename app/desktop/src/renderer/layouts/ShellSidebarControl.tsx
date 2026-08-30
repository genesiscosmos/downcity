/** App Shell 固定在窗口左上角的全局 Sidebar 控件。 */

import type { CSSProperties } from "react";
import { TbLayoutSidebar, TbLayoutSidebarFilled } from "react-icons/tb";
import { Button } from "@/components/ui/button";

/** 全局 Sidebar 的固定展开折叠按钮。 */
export function ShellSidebarControl({ collapsed, toggle_sidebar }: { /** Sidebar 是否折叠。 */ collapsed: boolean; /** 切换 Sidebar。 */ toggle_sidebar(): void }) {
  const left = navigator.platform.toLowerCase().includes("mac") ? 80 : 8;
  const no_drag_style = { WebkitAppRegion: "no-drag" } as CSSProperties;
  return <div className="fixed top-2 z-[100]" style={{ left, ...no_drag_style }}>
    <Button size="icon" style={no_drag_style} actived={!collapsed} onClick={toggle_sidebar} title={collapsed ? "展开侧边栏" : "折叠侧边栏"} aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}>{collapsed ? <TbLayoutSidebar /> : <TbLayoutSidebarFilled />}</Button>
  </div>;
}

/** MainView Shell 固定在窗口右上角的 BayBar 展开按钮。 */
export function MainViewBayBarControl({ open, toggle_baybar }: { /** BayBar 是否打开。 */ open: boolean; /** 切换 BayBar。 */ toggle_baybar(): void }) {
  const no_drag_style = { WebkitAppRegion: "no-drag" } as CSSProperties;
  return <div className="absolute right-2 top-2 z-[100]" style={no_drag_style}>
    <Button size="icon" style={no_drag_style} actived={open} onClick={toggle_baybar} title={open ? "收起右侧边栏" : "展开右侧边栏"} aria-label={open ? "收起右侧边栏" : "展开右侧边栏"}>{open ? <TbLayoutSidebarFilled className="-scale-x-100" /> : <TbLayoutSidebar className="-scale-x-100" />}</Button>
  </div>;
}
