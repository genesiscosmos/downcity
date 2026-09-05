/** Desktop 按业务职责组织的页面与应用组件。 */
import { useCallback, useMemo } from "react";
import { use_desktop_selector } from "@/app/use_desktop";
import type { DesktopController, NavigationTarget } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopSessionSummary, DesktopSettings, DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import { SessionView } from "@/features/chat/components/SessionTimeline";
import { DraftComposer } from "@/features/chat/composer/DraftComposer";
import { create_chat_composer } from "@/features/chat/composer/editor/chatComposerCodec";

import { WelcomeView } from "@/app/WelcomeView";

import { AgentChatMainView } from "@/features/agent/components/AgentChatDetails";
import { create_missing_workspace } from "@/features/chat/lib/chat_view_defaults";
import { empty_items } from "@/features/chat/lib/chat_view_defaults";

/** Agent Draft 路由订阅 Chat Surface 所需的最小目录集合。 */
export function AgentDraftRouteMainView({ selection, controller, sidebar_collapsed }: { /** Agent Draft 导航目标。 */ selection: Extract<NavigationTarget, { kind: "draft" }>; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const agent = agents.find((item) => item.agent_id === selection.agent_id);
  const workspaces = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces);
  const settings = use_desktop_selector(controller.stores.settings, (state) => state.settings);
  if (!agent) return <WelcomeView />;
  return <AgentChatMainView agent={agent} controller={controller} sidebar_collapsed={sidebar_collapsed} view_key={`agent-draft:${agent.agent_id}:${selection.draft_id}`}>
    {(open_agent_info) => <AgentDraftChatSurface selection={selection} agent={agent} open_agent_info={open_agent_info} workspaces={workspaces} agents={agents} settings={settings} controller={controller} />}
  </AgentChatMainView>;
}

/** Agent Draft 只组合空消息时间线与草稿输入能力。 */
export function AgentDraftChatSurface({ selection, agent, open_agent_info, workspaces, agents, settings, controller }: { /** 当前 Draft 导航目标。 */ selection: Extract<NavigationTarget, { kind: "draft" }>; /** Draft 所属 Agent。 */ agent: DesktopAgentSummary; /** 打开 Agent 编辑侧栏。 */ open_agent_info(): void; /** 可用 Workspace。 */ workspaces: DesktopWorkspaceSummary[]; /** 可用 Agent。 */ agents: DesktopAgentSummary[]; /** Chat 设置。 */ settings: DesktopSettings; /** Desktop 稳定控制器。 */ controller: DesktopController }) {
  const { workspace_id, agent_id, draft_id } = selection;
  const draft_session = useMemo<DesktopSessionSummary>(() => ({ session_id: draft_id, session_path: "", title: "新对话", preview_text: "", created_at: 0, updated_at: 0, message_count: 0, executing: false }), [draft_id]);
  const switch_workspace = useCallback((target_workspace_id: string) => controller.actions.switch_draft_context(target_workspace_id, agent_id), [agent_id, controller.actions]);
  const select_prompt = useCallback((prompt: string) => controller.actions.update_draft(workspace_id, agent_id, draft_id, create_chat_composer(prompt)), [agent_id, controller.actions, draft_id, workspace_id]);
  return <SessionView
    chat_surface="agent"
    open_agent_info={open_agent_info}
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
    select_prompt={select_prompt}
    composer={<DraftComposer selection={selection} stores={controller.stores} actions={controller.actions} />}
  />;
}
