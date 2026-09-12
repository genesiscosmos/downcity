/** MainView 卡片右上角的 BayBar 展开折叠按钮，与左侧 Sidebar 控件镜像。 */

import type { CSSProperties } from "react";
import { TbLayoutSidebar, TbLayoutSidebarFilled } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { use_translation } from "@/locales/i18n";
import { get_baybar_control_right, get_shell_control_top } from "./shellMotion";

/**
 * 右侧 BayBar 的固定展开折叠按钮。
 *
 * 它是切换右侧可见性的唯一入口：面板内部不再提供关闭按钮，
 * 点击 tab 也只切换显示内容，不会收起——避免同一个状态有多个入口。
 *
 * 位置与左侧 Sidebar 控件对称（都在 Header 行内、距卡片内边距一致），
 * 因此折叠时 MainView Header 会预留等宽空间，展开时由 BayBar 占据该位置。
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
  return <div className="fixed z-[100]" style={{ top: get_shell_control_top(), right: get_baybar_control_right(), ...no_drag_style }}>
    <Button size="icon" style={no_drag_style} actived={!collapsed} onClick={toggle_baybar} title={label} aria-label={label}>{collapsed ? <TbLayoutSidebar className="-scale-x-100" /> : <TbLayoutSidebarFilled className="-scale-x-100" />}</Button>
  </div>;
}
