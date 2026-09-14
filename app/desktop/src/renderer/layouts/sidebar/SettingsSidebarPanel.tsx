/** Desktop Sidebar 中的设置导航 Panel。 */

import { memo } from "react";
import { TbAdjustments, TbArrowLeft, TbBrush, TbCpu, TbKeyboard, TbMessageCircle, TbUser } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { use_desktop_selector } from "@/app/use_desktop";
import { use_translation } from "@/locales/i18n";
import type { DesktopController, SettingsSection } from "@/types/DesktopView";
import { SidebarContent, SidebarPanel } from "./SidebarPanel";

/** 设置 Panel 属性。 */
interface SettingsSidebarPanelProps {
  /** Renderer 根控制器。 */
  controller: DesktopController;
}

/** 只渲染 Rail 右侧的设置导航内容；Sidebar 外壳与 Rail 由 DesktopSidebar 唯一持有。 */
export const SettingsSidebarPanel = memo(function SettingsSidebarPanel({ controller }: SettingsSidebarPanelProps) {
  const translate = use_translation("settings");
  const common_translate = use_translation();
  const selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const active_section = selection?.kind === "settings" ? selection.section : "user";
  const settings_groups: Array<{ label: string; items: Array<{ section: SettingsSection; label: string; icon: typeof TbUser }> }> = [
    { label: translate("sections.account"), items: [
      { section: "user", label: translate("sections.account"), icon: TbUser },
      { section: "models", label: translate("sections.models"), icon: TbCpu },
    ] },
    { label: translate("title"), items: [
      { section: "general", label: translate("sections.general"), icon: TbAdjustments },
      { section: "appearance", label: translate("sections.appearance"), icon: TbBrush },
      { section: "chat", label: translate("sections.chat"), icon: TbMessageCircle },
      { section: "shortcuts", label: translate("sections.shortcuts"), icon: TbKeyboard },
    ] },
  ];

  return <SidebarPanel>
    <div className="shrink-0 px-2 pb-2">
      <Button size="sidebar" className="justify-start text-foreground" onClick={controller.actions.close_settings}>
        <TbArrowLeft />
        <span>{common_translate("actions.back")}</span>
      </Button>
    </div>
    <SidebarContent class_name="flex flex-col gap-2.5 py-1">
      {settings_groups.map((group) => <div key={group.label} className="flex min-w-0 flex-col gap-0.5">
        <div className="px-2.5 pb-1 text-[0.625rem] text-muted-foreground">{group.label}</div>
        <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-surface-subtle p-1.5">
          {group.items.map(({ section, label, icon: Icon }) => <Button key={section} size="sidebar" className="px-2.5 text-foreground" actived={active_section === section} onClick={() => controller.actions.open_settings(section)}><Icon /><span className="min-w-0 truncate">{label}</span></Button>)}
        </div>
      </div>)}
    </SidebarContent>
  </SidebarPanel>;
});
