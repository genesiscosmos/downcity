/** Sidebar Rail 中的一级导航入口。 */

import { Tooltip } from "@base-ui/react/tooltip";
import { TbComponents, TbGridDots, TbMoodNeutral } from "react-icons/tb";
import { PowerIcon } from "@/features/power/lib/PowerIcon";
import { AttentionRailDot } from "@/components/AttentionRailDot";
import type { DesktopPowerSummary } from "@common/types/DesktopApi";
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
  /** 提供动态一级入口的 Power。 */
  power_workspaces: DesktopPowerSummary[];
  /** 各一级导航的未读注意力等级；不在其中的一级导航没有未读。 */
  unread_attention_by_mode: ReadonlyMap<SidebarMode, ChatAttention>;
}

/** 只负责渲染 Sidebar Rail 的垂直导航入口。 */
export function SidebarNavigationItems({ active_mode, on_change, power_workspaces, unread_attention_by_mode }: SidebarNavigationItemsProps) {
  const translate = use_translation("navigation");
  const translate_chat = use_translation("chat");
  // 顺序即 Rail 顺序，也即 ⌘1 / ⌘2 / ⌘3 的映射（见 sidebar_shortcut）：
  // Works 在前，因为会话是这里最常去的地方；Agents 回答「有哪些 Agent」。
  const core_items = [
    // Works 的图标是点阵而不是文件夹：这一列装的是**对话**，不是目录树。
    // 文件夹图标会让人先想到「浏览文件」，而文件浏览已经在对话里的链接与右侧「文件」域里。
    { mode: "workspace", label: translate("views.workspaces"), icon: <TbGridDots /> },
    { mode: "chat", label: translate("views.agent"), icon: <TbMoodNeutral /> },
    { mode: "powers", label: translate("views.powers"), icon: <TbComponents /> },
  ] as const;
  const items = [
    ...core_items,
    ...power_workspaces.map((power) => ({
      mode: `power:${power.power_id}` as SidebarMode,
      label: power.title,
      icon: <PowerIcon power_id={power.power_id} icon_url={power.icon_url} />,
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
      const button = <button type="button" aria-current={active ? "page" : undefined} aria-label={accessible_label} title={accessible_label} className={cn("group/toggle relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-transparent text-muted-foreground outline-none transition-[background-color,color,box-shadow] duration-150 hover:bg-interaction-hover hover:text-foreground focus-visible:bg-interaction-hover focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0", active && "bg-interaction-selected text-foreground hover:bg-interaction-active")} onClick={() => on_change(item.mode)}>{item.icon}{unread_attention ? <AttentionRailDot attention={unread_attention} class_name="right-0.5 top-0.5 ring-2 ring-muted" /> : null}</button>;
      return <Tooltip.Root key={item.mode}><Tooltip.Trigger delay={300} render={button} /><Tooltip.Portal><Tooltip.Positioner side="right" sideOffset={8} className="z-50"><Tooltip.Popup className="flex items-center gap-3 rounded-control border border-border bg-background px-2 py-1 text-2xs text-foreground shadow-lg outline-none"><span>{item.label}</span>{shortcut ? <span className="text-muted-foreground">{shortcut}</span> : null}{unread_label ? <span className="text-muted-foreground">{unread_label}</span> : null}</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal></Tooltip.Root>;
    })}
  </nav>;
}
