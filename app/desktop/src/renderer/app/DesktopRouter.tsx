/** Desktop 按业务职责组织的页面与应用组件。 */

import type { DesktopController, NavigationTarget } from "@/types/DesktopView";

import { WelcomeView } from "@/app/WelcomeView";

import { CreateAgentMainView } from "@/features/agent/CreateAgentPage";
import { CreateGroupMainView } from "@/features/group/CreateGroupPage";
import { PluginRouteMainView } from "@/features/plugin/PluginPage";
import { WorkspaceRouteMainView } from "@/features/workspace/WorkspacePage";
import { GroupRouteMainView } from "@/features/group/GroupPage";
import { AgentRouteMainView } from "@/features/agent/AgentPage";
import { GroupChatRouteMainView } from "@/features/chat/GroupChatPage";
import { AgentDraftRouteMainView } from "@/features/chat/DraftChatPage";
import { AgentSessionRouteMainView } from "@/features/chat/SessionChatPage";
import { SettingsMainView } from "@/features/settings/SettingsPage";

/** 业务主视图只负责路由，不订阅任何领域数据。 */
export function DesktopMainView({ selection, controller, sidebar_collapsed }: { /** 当前导航目标。 */ selection: NavigationTarget | null; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  if (selection?.kind === "create_agent") return <CreateAgentMainView controller={controller} />;
  if (selection?.kind === "create_group") return <CreateGroupMainView controller={controller} />;
  if (selection?.kind === "settings") return <SettingsMainView key={`settings:${selection.section}`} controller={controller} section={selection.section} sidebar_collapsed={sidebar_collapsed} />;
  if (selection?.kind === "plugin" || selection?.kind === "plugin_workspace") return <PluginRouteMainView selection={selection} controller={controller} />;
  if (selection?.kind === "workspace" || selection?.kind === "workspace_file") return <WorkspaceRouteMainView selection={selection} controller={controller} sidebar_collapsed={sidebar_collapsed} />;
  if (selection?.kind === "group_session" || selection?.kind === "group_draft") return <GroupChatRouteMainView selection={selection} controller={controller} sidebar_collapsed={sidebar_collapsed} />;
  if (selection?.kind === "group") return <GroupRouteMainView selection={selection} controller={controller} sidebar_collapsed={sidebar_collapsed} />;
  if (selection?.kind === "agent") return <AgentRouteMainView selection={selection} controller={controller} sidebar_collapsed={sidebar_collapsed} />;
  if (selection?.kind === "draft") return <AgentDraftRouteMainView selection={selection} controller={controller} sidebar_collapsed={sidebar_collapsed} />;
  if (selection?.kind === "session") return <AgentSessionRouteMainView selection={selection} controller={controller} sidebar_collapsed={sidebar_collapsed} />;
  return <WelcomeView />;
}
