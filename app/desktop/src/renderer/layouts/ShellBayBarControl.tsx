/** 窗口右上角的 BayBar 展开折叠按钮，与左侧 Sidebar 控件镜像。 */

import type { CSSProperties } from "react";
import { TbLayoutSidebar, TbLayoutSidebarFilled } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { use_translation } from "@/locales/i18n";
import { SHELL_BAYBAR_CONTROL_RIGHT_CSS, SHELL_CONTROL_TOP_CSS } from "./shellMotion";

/**
 * 右侧面板的固定展开折叠按钮。
 *
 * 与左侧 Sidebar 控件是镜像关系：同一个纵向偏移、同一档尺寸与图标、距各自窗口边缘同宽。
 * 它是切换右侧可见性的唯一常驻入口——展开时浮在面板自己的 tab 行上，收起时浮在正文卡片上。
 *
 * 位置必须走 shellMotion 的 CSS 长度出口：它属于应用密度，要跟随界面缩放。
 */
export function ShellBayBarControl({ collapsed, toggle_baybar }: {
  /** BayBar 是否收起。 */
  collapsed: boolean;
  /** 切换 BayBar 可见性。 */
  toggle_baybar(): void;
}) {
  const translate = use_translation("navigation");
  const no_drag_style = { WebkitAppRegion: "no-drag" } as CSSProperties;
  const label = collapsed ? translate("panels.expand_right") : translate("panels.collapse_right");
  return <div className="fixed z-[100]" style={{ top: SHELL_CONTROL_TOP_CSS, right: SHELL_BAYBAR_CONTROL_RIGHT_CSS, ...no_drag_style }}>
    <Button size="icon" style={no_drag_style} actived={!collapsed} onClick={toggle_baybar} title={label} aria-label={label}>{collapsed ? <TbLayoutSidebar className="-scale-x-100" /> : <TbLayoutSidebarFilled className="-scale-x-100" />}</Button>
  </div>;
}
