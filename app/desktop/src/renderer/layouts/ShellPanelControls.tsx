/** Desktop Shell 层控件，独立于 Sidebar 与 MainView 的拖拽内容。 */

import { TbLayoutSidebar, TbLayoutSidebarFilled } from "react-icons/tb";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";

/** Shell 控件属性。 */
interface ShellPanelControlsProps {
  /** 当前 Sidebar 是否折叠。 */
  sidebar_collapsed: boolean;
  /** 切换 Sidebar 折叠状态。 */
  toggle_sidebar(): void;
}

/** 参考 Duobox 的左上角 Sidebar 控件。 */
export function ShellPanelControls({ sidebar_collapsed, toggle_sidebar }: ShellPanelControlsProps) {
  const left = navigator.platform.toLowerCase().includes("mac") ? 80 : 8;
  const no_drag_style = { WebkitAppRegion: "no-drag" } as CSSProperties;
  return <div className="shell-panel-controls absolute top-2 z-[100]" style={{ left, ...no_drag_style }}>
    <Button data-header-sidebar-toggle size="icon" style={no_drag_style} actived={!sidebar_collapsed} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onClick={toggle_sidebar} title={sidebar_collapsed ? "展开侧边栏" : "折叠侧边栏"} aria-label={sidebar_collapsed ? "展开侧边栏" : "折叠侧边栏"}>
      {sidebar_collapsed ? <TbLayoutSidebar /> : <TbLayoutSidebarFilled />}
    </Button>
  </div>;
}
