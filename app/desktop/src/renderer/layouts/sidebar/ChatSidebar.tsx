/** 组合 Chat 主体导航与当前主体 Session 面板。 */

import { memo } from "react";
import { TbGhost3, TbPlus, TbUsers } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { use_desktop_selector } from "@/app/use_desktop";
import { use_translation } from "@/locales/i18n";
import type { DesktopController } from "@/types/DesktopView";
import type { DesktopNotificationState } from "@common/types/DesktopNotification";
import { ChatSessionPanel } from "./ChatSessionPanel";
import { ChatSubjectList } from "./ChatSubjectList";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarPanel } from "./SidebarPanel";

/** Chat Sidebar 属性。 */
interface ChatSidebarProps {
  /** Renderer 根状态与操作入口。 */
  controller: DesktopController;
  /** 当前通知快照。 */
  notification_state: DesktopNotificationState;
  /** 打开创建 Agent 页面。 */
  open_create_agent(): void;
  /** 打开创建 Group 页面。 */
  open_create_group(): void;
  /** 打开 Group 配置。 */
  open_group_config(group_id: string): void;
}

/** 读取 Chat 目录状态，并组合主体列表和 Session 面板。 */
export const ChatSidebar = memo(function ChatSidebar({ controller, notification_state, open_create_agent, open_create_group, open_group_config }: ChatSidebarProps) {
  const translate = use_translation("navigation");
  const selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const active_workspace_id = use_desktop_selector(controller.stores.navigation, (state) => state.active_workspace_id);
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const groups = use_desktop_selector(controller.stores.catalog, (state) => state.groups);
  const workspaces = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces);
  const loading = use_desktop_selector(controller.stores.settings, (state) => state.loading);
  const selected_agent_id = selection && "agent_id" in selection ? selection.agent_id : "";
  const selected_group_id = selection && "group_id" in selection ? selection.group_id : "";
  const selected_agent = agents.find((agent) => agent.agent_id === selected_agent_id);
  const selected_group = groups.find((group) => group.group_id === selected_group_id);
  const workspace_id = active_workspace_id || workspaces[0]?.workspace_id;

  return <SidebarPanel>
    <SidebarHeader title={translate("views.chat")} actions={<DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" title={translate("sidebar.add_chat_subject")} aria-label={translate("sidebar.add_chat_subject")}><TbPlus /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={open_create_agent}><TbGhost3 /><span>{translate("sidebar.new_agent")}</span></DropdownMenuItem><DropdownMenuItem onClick={open_create_group}><TbUsers /><span>{translate("sidebar.new_group")}</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>} />
    <ChatSubjectList controller={controller} selected_agent_id={selected_agent_id} selected_group_id={selected_group_id} active_workspace_id={active_workspace_id} agents={agents} groups={groups} workspaces={workspaces} loading={loading} notification_state={notification_state} open_create_agent={open_create_agent} open_group_config={open_group_config} />
    <ChatSessionPanel controller={controller} notification_state={notification_state} selection={selection} selected_agent={selected_agent} selected_group={selected_group} workspace_id={workspace_id} />
  </SidebarPanel>;
});
