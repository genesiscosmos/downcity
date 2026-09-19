/**
 * Desktop Sidebar 中的设置导航 Panel。
 *
 * ## 顶部是一个普通的面板 Header
 *
 * 它此前是「一条占满宽度的返回按钮」，而其它面板的顶部是 36px 标题栏。两者高度不同，
 * 加上设置内容自己的上内边距，第一条就比别处低了 8px——切换 Rail 时左侧第一行会上下跳。
 * 现在返回是 Header 右侧的图标动作，与 Chat 的「新建」、Workspace 的「添加」同一位置。
 *
 * 返回不是唯一出口：Rail 上任意图标、以及命令面板的「返回上一个页面」都会离开设置，
 * 因此图标按钮不必再靠文字标签自证。
 *
 * ## 条目是 `settings` 变体：比 `default` 高一档
 *
 * 设置是一屏读得到的短列表，条目之间需要一点呼吸，因此它比 `default` 行高 8px（40 对 32）。
 * 行首槽 16、文字线 80 —— 与目录树同一条线，但行高不同：**层级用缩进表达，密度用行高表达**，
 * 两者不互相顶替。
 *
 * ## 分组卡片去掉，改用分组标签
 *
 * 条目此前装在一块 `rounded-surface bg-surface-subtle` 的卡片里，于是卡内条目的文字
 * 比其它面板的行右移了 6px——**同一类东西又落在另一条线上**。现在分组只用一个标签
 * 表达（与面板标题同一条左缘），条目本身是普通的行。
 */

import { memo } from "react";
import { TbAdjustments, TbArrowLeft, TbBrush, TbCpu, TbKeyboard, TbMessageCircle, TbUser } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { use_desktop_selector } from "@/app/use_desktop";
import { use_translation } from "@/locales/i18n";
import type { DesktopController, SettingsSection } from "@/types/DesktopView";
import { SidebarContent, SidebarPanel } from "./SidebarPanel";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarItem } from "./SidebarItem";

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
  /**
   * 分组标签不能再借用分区名。
   *
   * 原来的两组标签是「账户」与「设置」——前者与它自己的第一个条目同名，后者与面板标题同名，
   * 于是面板上同时出现两个「账户」和两个「设置」。标签回答的是「这一组是什么」，
   * 分区名回答的是「这一页是什么」，两者本来就不是一件事。
   */
  const settings_groups: Array<{ label: string; items: Array<{ section: SettingsSection; label: string; icon: typeof TbUser }> }> = [
    { label: translate("groups.account_models"), items: [
      { section: "user", label: translate("sections.account"), icon: TbUser },
      { section: "models", label: translate("sections.models"), icon: TbCpu },
    ] },
    { label: translate("groups.preferences"), items: [
      { section: "general", label: translate("sections.general"), icon: TbAdjustments },
      { section: "appearance", label: translate("sections.appearance"), icon: TbBrush },
      { section: "chat", label: translate("sections.chat"), icon: TbMessageCircle },
      { section: "shortcuts", label: translate("sections.shortcuts"), icon: TbKeyboard },
    ] },
  ];

  return <SidebarPanel>
    <SidebarHeader
      title={translate("title")}
      actions={<Button
        size="icon"
        title={common_translate("actions.back")}
        aria-label={common_translate("actions.back")}
        onClick={controller.actions.close_settings}
      ><TbArrowLeft /></Button>}
    />
    <SidebarContent class_name="space-y-4">
      {settings_groups.map((group) => <div key={group.label} className="flex min-w-0 flex-col space-y-0.5">
        {/* 分组标签与面板标题同线；条目本身是普通的 settings 行。 */}
        <div className="px-2 pb-1 text-2xs text-muted-foreground">{group.label}</div>
        {group.items.map(({ section, label, icon: Icon }) => (
          <SidebarItem
            key={section}
            variant="settings"
            active={active_section === section}
            leading={<Icon />}
            leading_shape="icon"
            title={label}
            onSelect={() => controller.actions.open_settings(section)}
          />
        ))}
      </div>)}
    </SidebarContent>
  </SidebarPanel>;
});
