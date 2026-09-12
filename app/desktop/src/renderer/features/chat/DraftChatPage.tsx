/** Desktop 按业务职责组织的页面与应用组件。 */
import { useCallback, useMemo } from "react";
import { use_desktop_selector } from "@/app/use_desktop";
import type { DesktopController, NavigationTarget } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopSessionSummary, DesktopSettings, DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import { SessionView } from "@/features/chat/components/SessionTimeline";
import { DraftComposer } from "@/features/chat/composer/DraftComposer";

import { WelcomeView } from "@/app/WelcomeView";

import { AgentChatMainView } from "@/features/agent/components/AgentChatDetails";
import { create_missing_workspace } from "@/features/chat/lib/chat_view_defaults";
import { empty_items } from "@/features/chat/lib/chat_view_defaults";
import { use_translation } from "@/locales/i18n";

/** Agent Draft 路由订阅 Chat Surface 所需的最小目录集合。 */
export function AgentDraftRouteMainView({ selection, controller, sidebar_collapsed }: { /** Agent Draft 导航目标。 */ selection: Extract<NavigationTarget, { kind: "draft" }>; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const agent = agents.find((item) => item.agent_id === selection.agent_id);
  const workspaces = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces);
  const settings = use_desktop_selector(controller.stores.settings, (state) => state.settings);
  if (!agent) return <WelcomeView />;
  return <AgentChatMainView agent={agent} controller={controller} view_key={`agent-draft:${agent.agent_id}:${selection.draft_id}`}>
    <AgentDraftChatSurface selection={selection} agent={agent} workspaces={workspaces} agents={agents} settings={settings} controller={controller} />
  </AgentChatMainView>;
}

/** Agent Draft 只组合空消息时间线与草稿输入能力。 */
export function AgentDraftChatSurface({ selection, agent, workspaces, agents, settings, controller }: { /** 当前 Draft 导航目标。 */ selection: Extract<NavigationTarget, { kind: "draft" }>; /** Draft 所属 Agent。 */ agent: DesktopAgentSummary; /** 可用 Workspace。 */ workspaces: DesktopWorkspaceSummary[]; /** 可用 Agent。 */ agents: DesktopAgentSummary[]; /** Chat 设置。 */ settings: DesktopSettings; /** Desktop 稳定控制器。 */ controller: DesktopController }) {
  const translate = use_translation("chat");
  const { workspace_id, agent_id, draft_id } = selection;
  const draft_session = useMemo<DesktopSessionSummary>(() => ({ session_id: draft_id, session_path: "", title: translate("conversation.new"), preview_text: "", created_at: 0, updated_at: 0, message_count: 0, executing: false }), [draft_id, translate]);
  const switch_workspace = useCallback((target_workspace_id: string) => controller.actions.switch_draft_context(target_workspace_id, agent_id), [agent_id, controller.actions]);
  return <SessionView
    chat_surface="agent"
    open_workspace_file={controller.actions.select_workspace_file}
    workspace_id={workspace_id}
    agent={agent}
    workspace={workspaces.find((workspace) => workspace.workspace_id === workspace_id) ?? create_missing_workspace(workspace_id)}
    workspaces={workspaces}
    workspace_draft_mode
    switch_workspace={switch_workspace}
    agents={agents}
    session={draft_session}
    messages={empty_items}
    settings={settings}
    switch_draft_context={controller.actions.switch_draft_context}
    composer={<DraftComposer selection={selection} stores={controller.stores} actions={controller.actions} />}
  />;
}
