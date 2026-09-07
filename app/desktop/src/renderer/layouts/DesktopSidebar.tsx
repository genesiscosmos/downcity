/** Downcity Desktop 的可切换业务 Sidebar。 */

import { memo, useMemo } from "react";
import { SidebarFrame } from "./sidebar/SidebarFrame";
import type { DesktopController } from "@/types/DesktopView";
import { use_desktop_selector } from "@/app/use_desktop";
import { ChatSidebar } from "./sidebar/ChatSidebar";
import { PluginSidebar } from "./sidebar/PluginSidebar";
import { PluginWorkspaceSidebar } from "./sidebar/PluginWorkspaceSidebar";
import { WorkspaceSidebar } from "./sidebar/WorkspaceSidebar";
import { SidebarRail } from "./sidebar/SidebarRail";
import { SettingsSidebarPanel } from "./sidebar/SettingsSidebarPanel";
import { has_unread_chat_notification, has_unread_plugin_notification } from "@/lib/notification/notification_state";

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
  const plugins = use_desktop_selector(controller.stores.catalog, (state) => state.plugins);
  const sidebar_mode = use_desktop_selector(controller.stores.navigation, (state) => state.sidebar_mode);
  const selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const settings_active = selection?.kind === "settings";
  const notification_state = use_desktop_selector(controller.stores.notification, (state) => state);
  const plugin_workspaces = useMemo(() => plugins.filter((plugin) => plugin.has_sidebar && plugin.has_mainview), [plugins]);
  const unread_modes = useMemo(() => [
    ...(has_unread_chat_notification(notification_state) ? ["chat" as const] : []),
    ...plugin_workspaces
      .filter((plugin) => has_unread_plugin_notification(notification_state, plugin.plugin_id))
      .map((plugin) => `plugin:${plugin.plugin_id}` as const),
  ], [notification_state, plugin_workspaces]);
  const workspace_plugin_id = sidebar_mode.startsWith("plugin:")
    ? sidebar_mode.slice("plugin:".length)
    : undefined;
  return <SidebarFrame collapsed={collapsed}>
    <SidebarRail active_mode={settings_active ? undefined : sidebar_mode} on_change={controller.actions.set_sidebar_mode} plugin_workspaces={plugin_workspaces} unread_modes={unread_modes} settings_active={settings_active} open_settings={() => controller.actions.open_settings("user")} />
    {settings_active ? <SettingsSidebarPanel controller={controller} /> : <>
      {sidebar_mode === "chat" ? <ChatSidebar controller={controller} notification_state={notification_state} open_create_agent={() => open_create_agent()} open_create_group={open_create_group} open_group_config={open_group_config} /> : null}
      {sidebar_mode === "workspace" ? <WorkspaceSidebar controller={controller} open_create_workspace={open_create_workspace} /> : null}
      {sidebar_mode === "plugins" ? <PluginSidebar controller={controller} /> : null}
      {workspace_plugin_id ? <PluginWorkspaceSidebar controller={controller} plugin_id={workspace_plugin_id} notification_state={notification_state} /> : null}
    </>}
  </SidebarFrame>;
});
