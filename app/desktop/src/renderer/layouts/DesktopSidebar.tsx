/** Downcity Desktop 的可切换业务 Sidebar。 */

import { memo, useMemo } from "react";
import { SidebarFrame } from "./sidebar/SidebarFrame";
import type { DesktopController, SidebarMode } from "@/types/DesktopView";
import { use_desktop_selector } from "@/app/use_desktop";
import { ChatSidebar } from "./sidebar/ChatSidebar";
import { PowerSidebar } from "./sidebar/PowerSidebar";
import { PowerWorkspaceSidebar } from "./sidebar/PowerWorkspaceSidebar";
import { WorkspaceSidebar } from "./sidebar/WorkspaceSidebar";
import { SidebarRail } from "./sidebar/SidebarRail";
import { SettingsSidebarPanel } from "./sidebar/SettingsSidebarPanel";
import { get_chat_unread_attention, has_unread_power_notification } from "@/lib/notification/notification_state";
import { order_rail_powers } from "@/features/navigation/lib/sidebar_shortcut";
import type { ChatAttention } from "@/lib/notification/attention";

/** 左侧导航面板属性。 */
interface DesktopSidebarProps {
  /** Renderer 根状态与操作入口。 */
  controller: DesktopController;
  /** 打开创建 Agent 表单。 */
  open_create_agent(workspace_id?: string): void;
  /** 打开创建 Group 页面。 */
  open_create_group(): void;
  /** 打开创建 Workspace 表单。 */
  open_create_workspace(): void;
  /** 打开 Group 并展示其配置侧栏。 */
  open_group_config(group_id: string): void;
  /** 是否隐藏左侧导航栏。 */
  collapsed?: boolean;
}

/** Desktop 左侧业务 Sidebar，负责组合 Rail 与当前业务 Panel。 */
export const DesktopSidebar = memo(function DesktopSidebar({ controller, open_create_agent, open_create_group, open_create_workspace, open_group_config, collapsed = false }: DesktopSidebarProps) {
  const powers = use_desktop_selector(controller.stores.catalog, (state) => state.powers);
  const sidebar_mode = use_desktop_selector(controller.stores.navigation, (state) => state.sidebar_mode);
  const selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const settings_active = selection?.kind === "settings";
  const notification_state = use_desktop_selector(controller.stores.notification, (state) => state);
  const power_workspaces = useMemo(() => order_rail_powers(powers), [powers]);
  const unread_attention_by_mode = useMemo(() => {
    const entries: [SidebarMode, ChatAttention][] = [];
    const chat_attention = get_chat_unread_attention(notification_state);
    if (chat_attention) entries.push(["chat", chat_attention]);
    for (const power of power_workspaces) {
      // Power 通知不区分注意力等级；有未读时统一按「有新结果」展示。
      if (has_unread_power_notification(notification_state, power.power_id)) entries.push([`power:${power.power_id}`, "completed"]);
    }
    return new Map(entries);
  }, [notification_state, power_workspaces]);
  const workspace_power_id = sidebar_mode.startsWith("power:")
    ? sidebar_mode.slice("power:".length)
    : undefined;
  return <SidebarFrame collapsed={collapsed}>
    <SidebarRail active_mode={settings_active ? undefined : sidebar_mode} on_change={controller.actions.set_sidebar_mode} power_workspaces={power_workspaces} unread_attention_by_mode={unread_attention_by_mode} settings_active={settings_active} open_settings={() => controller.actions.open_settings("user")} />
    {settings_active ? <SettingsSidebarPanel controller={controller} /> : <>
      {sidebar_mode === "chat" ? <ChatSidebar controller={controller} notification_state={notification_state} open_create_agent={() => open_create_agent()} open_create_group={open_create_group} open_group_config={open_group_config} /> : null}
      {sidebar_mode === "workspace" ? <WorkspaceSidebar controller={controller} open_create_workspace={open_create_workspace} /> : null}
      {sidebar_mode === "powers" ? <PowerSidebar controller={controller} /> : null}
      {workspace_power_id ? <PowerWorkspaceSidebar controller={controller} power_id={workspace_power_id} notification_state={notification_state} /> : null}
    </>}
  </SidebarFrame>;
});
