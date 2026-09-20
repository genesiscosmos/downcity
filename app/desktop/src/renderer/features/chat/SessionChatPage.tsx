/** Desktop 按业务职责组织的页面与应用组件。 */
import { useCallback } from "react";

import type { RespondSessionInteractionInput } from "@downcity/agent";

import { use_desktop_selector } from "@/app/use_desktop";

import { get_session_key } from "@/features/chat/lib/chat_cache_key";
import { project_active_turn_file_diff } from "@/features/chat/lib/chat_runtime_projection";
import { use_chat_file_panel } from "@/features/chat/panel/ChatFilePanel";
import type { DesktopController, NavigationTarget } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopChatRewriteInput, DesktopSessionSummary, DesktopSettings, DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import { SessionView } from "@/features/chat/components/SessionTimeline";
import { SessionComposer } from "@/features/chat/composer/SessionComposer";

import { WelcomeView } from "@/app/WelcomeView";

import { AgentChatMainView } from "@/features/agent/components/AgentChatDetails";
import { create_missing_workspace } from "@/features/chat/lib/chat_view_defaults";
import { empty_items } from "@/features/chat/lib/chat_view_defaults";

/** Agent Session 路由只订阅当前 Session 及 Chat Surface 依赖。 */
export function AgentSessionRouteMainView({ selection, controller, sidebar_collapsed }: { /** Agent Session 导航目标。 */ selection: Extract<NavigationTarget, { kind: "session" }>; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const agent = agents.find((item) => item.agent_id === selection.agent_id);
  const workspaces = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces);
  const settings = use_desktop_selector(controller.stores.settings, (state) => state.settings);
  const session_key = get_session_key(selection.workspace_id, selection.agent_id, selection.session_id);
  const session = use_desktop_selector(controller.stores.session, (state) => (state.sessions_by_workspace[selection.workspace_id] ?? []).find((item) => item.agent_id === selection.agent_id && item.session.session_id === selection.session_id)?.session);
  if (!agent || !session) return <WelcomeView />;
  return <AgentChatMainView agent={agent} controller={controller} workspace_id={selection.workspace_id} workspace_path={workspaces.find((item) => item.workspace_id === selection.workspace_id)?.workspace_path} view_key={`agent-session:${agent.agent_id}:${session.session_id}`} session_key={session_key} session_title={session.title}>
    <AgentSessionChatSurface selection={selection} agent={agent} session={session} workspaces={workspaces} agents={agents} settings={settings} controller={controller} />
  </AgentChatMainView>;
}

/** 已创建 Agent Session 的高频状态消费边界。 */
export function AgentSessionChatSurface({ selection, agent, session, workspaces, agents, settings, controller }: { /** 当前 Session 导航目标。 */ selection: Extract<NavigationTarget, { kind: "session" }>; /** Session 所属 Agent。 */ agent: DesktopAgentSummary; /** 当前 Session 摘要。 */ session: DesktopSessionSummary; /** 可用 Workspace。 */ workspaces: DesktopWorkspaceSummary[]; /** 可用 Agent。 */ agents: DesktopAgentSummary[]; /** Chat 设置。 */ settings: DesktopSettings; /** Desktop 稳定控制器。 */ controller: DesktopController }) {
  // 对话里的文件在右侧面板就地打开，不再切走整个主视图到 Workspace 页。
  const open_file = use_chat_file_panel();
  const { workspace_id, agent_id, session_id } = selection;
  const session_key = get_session_key(workspace_id, agent_id, session_id);
  const messages = use_desktop_selector(controller.stores.chat_stream, (state) => state.messages_by_session[session_key]);
  const runtime = use_desktop_selector(controller.stores.chat_stream, (state) => state.chat_runtime_by_session[session_key]);
  const latest_file_diff = use_desktop_selector(controller.stores.chat_stream, (state) => state.file_diff_by_session[session_key]);
  const file_diff = project_active_turn_file_diff(runtime, latest_file_diff);
  const history = use_desktop_selector(controller.stores.chat_stream, (state) => state.history_by_session[session_key]);
  const has_queued_messages = use_desktop_selector(controller.stores.composer, (state) => (state.queued_messages_by_session[session_key]?.length ?? 0) > 0);
  const switch_workspace = useCallback((target_workspace_id: string) => controller.actions.create_session(target_workspace_id, agent_id), [agent_id, controller.actions]);
  const rename_session = useCallback((title: string) => controller.actions.rename_session(workspace_id, agent_id, session_id, title), [agent_id, controller.actions, session_id, workspace_id]);
  const archive_session = useCallback(() => controller.actions.archive_session(workspace_id, agent_id, session_id), [agent_id, controller.actions, session_id, workspace_id]);
  const remove_session = useCallback(() => controller.actions.remove_session(workspace_id, agent_id, session_id), [agent_id, controller.actions, session_id, workspace_id]);
  const respond_interaction = useCallback((input: RespondSessionInteractionInput) => controller.actions.respond_interaction(workspace_id, agent_id, session_id, input), [agent_id, controller.actions, session_id, workspace_id]);
  const fork_message = useCallback((message_id: string) => controller.actions.fork_session(workspace_id, agent_id, session_id, message_id), [agent_id, controller.actions, session_id, workspace_id]);
  const rewrite_message = useCallback((input: DesktopChatRewriteInput) => controller.actions.rewrite_session_message(workspace_id, agent_id, session_id, input), [agent_id, controller.actions, session_id, workspace_id]);
  const load_earlier_history = useCallback(() => controller.actions.load_earlier_history(workspace_id, agent_id, session_id), [agent_id, controller.actions, session_id, workspace_id]);
  return <SessionView
    chat_surface="agent"
    open_file={open_file}
    workspace_id={workspace_id}
    agent={agent}
    workspace={workspaces.find((workspace) => workspace.workspace_id === workspace_id) ?? create_missing_workspace(workspace_id)}
    workspace_missing={!workspaces.some((workspace) => workspace.workspace_id === workspace_id)}
    workspaces={workspaces}
    switch_workspace={switch_workspace}
    agents={agents}
    session={session}
    messages={messages ?? empty_items}
    runtime={runtime}
    file_diff_by_session={file_diff}
    history={history}
    settings={settings}
    rename_session={rename_session}
    archive_session={archive_session}
    remove_session={remove_session}
    switch_draft_context={controller.actions.switch_draft_context}
    composer={<SessionComposer selection={selection} stores={controller.stores} actions={controller.actions} />}
    respond_interaction={respond_interaction}
    fork_message={fork_message}
    rewrite_message={rewrite_message}
    can_replace_session={!has_queued_messages}
    load_earlier_history={load_earlier_history}
  />;
}
