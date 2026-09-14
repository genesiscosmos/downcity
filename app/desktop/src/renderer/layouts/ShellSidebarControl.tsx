/** App Shell 固定在窗口左上角的全局 Sidebar 控件。 */

import type { CSSProperties } from "react";
import { TbLayoutSidebar, TbLayoutSidebarFilled } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { shell_control_left_css, SHELL_CONTROL_TOP_CSS } from "./shellMotion";
import { use_translation } from "@/locales/i18n";

/** 全局 Sidebar 的固定展开折叠按钮。 */
export function ShellSidebarControl({ collapsed, toggle_sidebar }: { /** Sidebar 是否折叠。 */ collapsed: boolean; /** 切换 Sidebar。 */ toggle_sidebar(): void }) {
  const translate = use_translation("navigation");
  const no_drag_style = { WebkitAppRegion: "no-drag" } as CSSProperties;
  // 与右侧按钮共用同一纵向偏移，保证两侧在 MainView Header 行上水平对齐。
  // 位置必须走 CSS 长度出口：左侧含 macOS 红绿灯的固定留白，缩放界面时不能跟着变。
  return <div className="fixed z-[100]" style={{ top: SHELL_CONTROL_TOP_CSS, left: shell_control_left_css(), ...no_drag_style }}>
    <Button size="icon" style={no_drag_style} actived={!collapsed} onClick={toggle_sidebar} title={collapsed ? translate("sidebar.expand") : translate("sidebar.collapse")} aria-label={collapsed ? translate("sidebar.expand") : translate("sidebar.collapse")}>{collapsed ? <TbLayoutSidebar /> : <TbLayoutSidebarFilled />}</Button>
  </div>;
}
