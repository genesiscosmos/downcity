/** Sidebar Rail 中的一级导航入口。 */

import { Tooltip } from "@base-ui/react/tooltip";
import { TbComponents, TbFolder, TbMoodNeutral } from "react-icons/tb";
import { PluginIcon } from "@/features/plugin/lib/PluginIcon";
import type { DesktopPluginSummary } from "@common/types/DesktopApi";
import { cn } from "@/lib/utils";
import type { SidebarMode } from "@/types/DesktopView";
import { use_translation } from "@/locales/i18n";

/** 一级导航入口属性。 */
interface SidebarNavigationItemsProps {
  /** 当前选中的一级导航。 */
  active_mode?: SidebarMode;
  /** 切换一级导航。 */
  on_change(mode: SidebarMode): void;
  /** 提供动态一级入口的 Plugin。 */
  plugin_workspaces: DesktopPluginSummary[];
  /** 需要显示未读提示的一级导航。 */
  unread_modes: readonly SidebarMode[];
}

/** 只负责渲染 Sidebar Rail 的垂直导航入口。 */
export function SidebarNavigationItems({ active_mode, on_change, plugin_workspaces, unread_modes }: SidebarNavigationItemsProps) {
  const translate = use_translation("navigation");
  const core_items = [
    { mode: "chat", label: translate("views.agent"), icon: <TbMoodNeutral /> },
    { mode: "workspace", label: translate("views.workspaces"), icon: <TbFolder /> },
    { mode: "plugins", label: translate("views.plugins"), icon: <TbComponents /> },
  ] as const;
  const items = [
    ...core_items,
    ...plugin_workspaces.map((plugin) => ({
      mode: `plugin:${plugin.plugin_id}` as SidebarMode,
      label: plugin.title,
      icon: <PluginIcon plugin_id={plugin.plugin_id} icon_url={plugin.icon_url} />,
    })),
  ];
  return <nav aria-label={translate("view_switcher")} className="scrollbar-none flex min-h-0 w-8 flex-1 flex-col gap-1 overflow-y-auto">
    {items.map((item, index) => {
      const active = item.mode === active_mode;
      const unread = unread_modes.includes(item.mode);
      const shortcut = index < 9 ? `⌘${index + 1}` : undefined;
      const accessible_label = shortcut ? `${item.label} (${shortcut})` : item.label;
      const button = <button type="button" aria-current={active ? "page" : undefined} aria-label={accessible_label} title={accessible_label} className={cn("group/toggle relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-transparent text-muted-foreground outline-none transition-[background-color,color,box-shadow] duration-150 hover:bg-interaction-hover hover:text-foreground focus-visible:bg-interaction-hover focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0", active && "bg-interaction-selected text-foreground hover:bg-interaction-active")} onClick={() => on_change(item.mode)}>{item.icon}{unread ? <span aria-label={translate("unread")} className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-blue-500 ring-2 ring-muted" /> : null}</button>;
      return <Tooltip.Root key={item.mode}><Tooltip.Trigger delay={300} render={button} /><Tooltip.Portal><Tooltip.Positioner side="right" sideOffset={8} className="z-50"><Tooltip.Popup className="flex items-center gap-3 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground shadow-lg outline-none"><span>{item.label}</span>{shortcut ? <span className="text-muted-foreground">{shortcut}</span> : null}</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal></Tooltip.Root>;
    })}
  </nav>;
}
