/** Sidebar Rail 中的一级导航入口。 */

import { Tooltip } from "@base-ui/react/tooltip";
import { TbComponents, TbFolder, TbMoodNeutral } from "react-icons/tb";
import { PluginIcon } from "@/features/plugin/lib/PluginIcon";
import { AttentionRailDot } from "@/components/AttentionRailDot";
import type { DesktopPluginSummary } from "@common/types/DesktopApi";
import { cn } from "@/lib/utils";
import type { SidebarMode } from "@/types/DesktopView";
import type { ChatAttention } from "@/lib/notification/attention";
import { attention_visual } from "@/lib/notification/attention";
import { use_translation } from "@/locales/i18n";

/** 一级导航入口属性。 */
interface SidebarNavigationItemsProps {
  /** 当前选中的一级导航。 */
  active_mode?: SidebarMode;
  /** 切换一级导航。 */
  on_change(mode: SidebarMode): void;
  /** 提供动态一级入口的 Plugin。 */
  plugin_workspaces: DesktopPluginSummary[];
  /** 各一级导航的未读注意力等级；不在其中的一级导航没有未读。 */
  unread_attention_by_mode: ReadonlyMap<SidebarMode, ChatAttention>;
}

/** 只负责渲染 Sidebar Rail 的垂直导航入口。 */
export function SidebarNavigationItems({ active_mode, on_change, plugin_workspaces, unread_attention_by_mode }: SidebarNavigationItemsProps) {
  const translate = use_translation("navigation");
  const translate_chat = use_translation("chat");
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
      const unread_attention = unread_attention_by_mode.get(item.mode);
      const shortcut = index < 9 ? `⌘${index + 1}` : undefined;
      // 圆点的可读名称会被按钮名覆盖，所以未读状态直接写进按钮名称与提示文案。
      const unread_label = unread_attention ? translate_chat(attention_visual[unread_attention].label_key) : "";
      const accessible_label = [shortcut ? `${item.label} (${shortcut})` : item.label, unread_label].filter(Boolean).join(", ");
      const button = <button type="button" aria-current={active ? "page" : undefined} aria-label={accessible_label} title={accessible_label} className={cn("group/toggle relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-transparent text-muted-foreground outline-none transition-[background-color,color,box-shadow] duration-150 hover:bg-interaction-hover hover:text-foreground focus-visible:bg-interaction-hover focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0", active && "bg-interaction-selected text-foreground hover:bg-interaction-active")} onClick={() => on_change(item.mode)}>{item.icon}{unread_attention ? <AttentionRailDot attention={unread_attention} class_name="right-0.5 top-0.5 ring-2 ring-muted" /> : null}</button>;
      return <Tooltip.Root key={item.mode}><Tooltip.Trigger delay={300} render={button} /><Tooltip.Portal><Tooltip.Positioner side="right" sideOffset={8} className="z-50"><Tooltip.Popup className="flex items-center gap-3 rounded-md border border-border bg-background px-2 py-1 text-[0.6875rem] text-foreground shadow-lg outline-none"><span>{item.label}</span>{shortcut ? <span className="text-muted-foreground">{shortcut}</span> : null}{unread_label ? <span className="text-muted-foreground">{unread_label}</span> : null}</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal></Tooltip.Root>;
    })}
  </nav>;
}
