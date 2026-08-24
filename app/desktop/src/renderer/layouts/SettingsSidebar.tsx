/** Downcity Desktop 设置路由使用的 Sidebar。 */

import { TbAdjustments, TbArrowLeft, TbBrush, TbCpu, TbMessageCircle, TbUser } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import type { DesktopViewController, SettingsSection } from "@/types/DesktopView";
import { SidebarContainer } from "./NavigationSidebar";

/** 设置 Sidebar 属性。 */
interface SettingsSidebarProps {
  /** Renderer 根控制器。 */
  controller: DesktopViewController;
  /** 是否隐藏左侧设置栏。 */
  collapsed?: boolean;
}

const settings_groups: Array<{ label: string; items: Array<{ section: SettingsSection; label: string; icon: typeof TbUser }> }> = [
  { label: "账户", items: [
    { section: "user", label: "用户", icon: TbUser },
    { section: "models", label: "模型", icon: TbCpu },
  ] },
  { label: "应用", items: [
    { section: "general", label: "通用", icon: TbAdjustments },
    { section: "appearance", label: "外观", icon: TbBrush },
    { section: "chat", label: "对话", icon: TbMessageCircle },
  ] },
];

/** 与 Duobox SettingsSidebar 一致，设置导航直接替换应用 Sidebar 内容。 */
export function SettingsSidebar({ controller, collapsed = false }: SettingsSidebarProps) {
  const active_section = controller.selection?.kind === "settings" ? controller.selection.section : "user";
  return <SidebarContainer collapsed={collapsed}>
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="relative flex h-9 shrink-0 items-center"><div className="header-drag-region absolute inset-0" /></div>
      <div className="shrink-0 px-2 pb-2">
        <Button size="sidebar" className="justify-start text-foreground/80" onClick={controller.close_settings}>
          <TbArrowLeft />
          <span>返回</span>
        </Button>
      </div>
      <div className="sidebar-body-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-2 py-1">
        {settings_groups.map((group) => <div key={group.label} className="flex min-w-0 flex-col gap-0.5">
          <div className="px-2.5 pb-1 text-[10px] text-muted-foreground/65">{group.label}</div>
          <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-surface-subtle p-1.5">{group.items.map(({ section, label, icon: Icon }) => <Button key={section} size="sidebar" className="px-2.5 text-foreground/80" actived={active_section === section} onClick={() => controller.open_settings(section)}><Icon /><span className="min-w-0 truncate">{label}</span></Button>)}</div>
        </div>)}
      </div>
    </div>
  </SidebarContainer>;
}
