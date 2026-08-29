/** Desktop Shell 固定控件，参考 Duobox 放置左右面板开关。 */

import type { CSSProperties } from "react";
import { TbLayoutSidebar, TbLayoutSidebarFilled } from "react-icons/tb";
import { Button } from "@/components/ui/button";

/** Shell 固定控件属性。 */
interface ShellPanelControlsProps {
  /** 左侧 Sidebar 是否折叠。 */
  sidebar_collapsed: boolean;
  /** 切换左侧 Sidebar。 */
  toggle_sidebar(): void;
  /** 右侧 BayBar 是否打开。 */
  baybar_open: boolean;
  /** 切换右侧 BayBar。 */
  toggle_baybar(): void;
}

/** 固定在窗口左右边界，不参与页面内容排版。 */
export function ShellPanelControls({ sidebar_collapsed, toggle_sidebar, baybar_open, toggle_baybar }: ShellPanelControlsProps) {
  const left = navigator.platform.toLowerCase().includes("mac") ? 80 : 8;
  const no_drag_style = { WebkitAppRegion: "no-drag" } as CSSProperties;
  return <>
    <div className="shell-panel-controls fixed left-0 top-2 z-[100]" style={{ left, ...no_drag_style }}>
      <Button size="icon" style={no_drag_style} actived={!sidebar_collapsed} onClick={toggle_sidebar} title={sidebar_collapsed ? "展开侧边栏" : "折叠侧边栏"} aria-label={sidebar_collapsed ? "展开侧边栏" : "折叠侧边栏"}>{sidebar_collapsed ? <TbLayoutSidebar /> : <TbLayoutSidebarFilled />}</Button>
    </div>
    <div className="shell-panel-controls fixed right-2 top-2 z-[100]" style={no_drag_style}>
      <Button size="icon" style={no_drag_style} actived={baybar_open} onClick={toggle_baybar} title={baybar_open ? "收起右侧边栏" : "展开右侧边栏"} aria-label={baybar_open ? "收起右侧边栏" : "展开右侧边栏"}>{baybar_open ? <TbLayoutSidebarFilled className="-scale-x-100" /> : <TbLayoutSidebar className="-scale-x-100" />}</Button>
    </div>
  </>;
}
