/** Desktop Sidebar 共用的左侧一级图标导航栏。 */

import { Tooltip } from "@base-ui/react/tooltip";
import { TbSettings } from "react-icons/tb";
import type { DesktopPowerSummary } from "@common/types/DesktopApi";
import { SidebarNavigationItems } from "./SidebarNavigationItems";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";
import type { SidebarMode } from "@/types/DesktopView";
import type { ChatAttention } from "@/lib/notification/attention";

/** 左侧一级图标导航栏属性。 */
interface SidebarRailProps {
  /** 当前业务导航模式；设置页不选中任何业务入口。 */
  active_mode?: SidebarMode;
  /** 切换业务导航模式。 */
  on_change(mode: SidebarMode): void;
  /** 动态贡献一级入口的 Power。 */
  power_workspaces: DesktopPowerSummary[];
  /** 各业务入口的未读注意力等级；不在其中的入口没有未读。 */
  unread_attention_by_mode: ReadonlyMap<SidebarMode, ChatAttention>;
  /** 设置入口是否处于激活状态。 */
  settings_active: boolean;
  /** 打开设置页。 */
  open_settings(): void;
}

/** 展示业务入口，并把设置作为固定在底部的独立图标按钮。 */
export function SidebarRail(props: SidebarRailProps) {
  const translate = use_translation("navigation");
  const settings_label = translate("views.settings");
  const settings_button = <button
    type="button"
    aria-current={props.settings_active ? "page" : undefined}
    aria-label={settings_label}
    className={cn(
      "relative inline-flex size-8 shrink-0 items-center justify-center rounded-control bg-transparent text-muted-foreground outline-none transition-[background-color,color,box-shadow] duration-150 hover:bg-interaction-hover hover:text-foreground focus-visible:bg-interaction-hover focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:size-4",
      props.settings_active && "bg-interaction-selected text-foreground hover:bg-interaction-active",
    )}
    onClick={() => {
      if (!props.settings_active) props.open_settings();
    }}
  ><TbSettings /></button>;

  return <div className="flex min-h-0 w-10 shrink-0 flex-col items-center pb-2 pl-2">
    <SidebarNavigationItems active_mode={props.active_mode} on_change={props.on_change} power_workspaces={props.power_workspaces} unread_attention_by_mode={props.unread_attention_by_mode} />
    <Tooltip.Root>
      <Tooltip.Trigger delay={300} render={settings_button} />
      <Tooltip.Portal><Tooltip.Positioner side="right" sideOffset={8} className="z-50"><Tooltip.Popup className="rounded-control border border-border bg-background px-2 py-1 text-2xs text-foreground shadow-lg outline-none">{settings_label}</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>
    </Tooltip.Root>
  </div>;
}
