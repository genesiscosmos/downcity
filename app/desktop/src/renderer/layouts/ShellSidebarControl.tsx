/** App Shell 固定在窗口左上角的全局 Sidebar 控件。 */

import type { CSSProperties } from "react";
import { TbLayoutSidebar, TbLayoutSidebarFilled } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { use_translation } from "@/locales/i18n";

/** 全局 Sidebar 的固定展开折叠按钮。 */
export function ShellSidebarControl({ collapsed, toggle_sidebar }: { /** Sidebar 是否折叠。 */ collapsed: boolean; /** 切换 Sidebar。 */ toggle_sidebar(): void }) {
  const translate = use_translation("navigation");
  const left = navigator.platform.toLowerCase().includes("mac") ? 80 : 8;
  const no_drag_style = { WebkitAppRegion: "no-drag" } as CSSProperties;
  return <div className="fixed top-2 z-[100]" style={{ left, ...no_drag_style }}>
    <Button size="icon" style={no_drag_style} actived={!collapsed} onClick={toggle_sidebar} title={collapsed ? translate("sidebar.expand") : translate("sidebar.collapse")} aria-label={collapsed ? translate("sidebar.expand") : translate("sidebar.collapse")}>{collapsed ? <TbLayoutSidebar /> : <TbLayoutSidebarFilled />}</Button>
  </div>;
}
