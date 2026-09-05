/** Downcity Desktop 根应用壳，直接沿用 Duobox 的 Sidebar + MainView 结构。 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { JSONContent } from "@tiptap/core";
import type { RespondSessionInteractionInput } from "@downcity/agent";
import { CreateWorkspaceDialog } from "@/components/CreateWorkspaceDialog";
import { AttachSessionWorkspaceDialog } from "@/components/AttachSessionWorkspaceDialog";
import { Button } from "@/components/ui/button";
import { use_desktop_controller, use_desktop_selector } from "@/hooks/use_desktop_controller";
import { NavigationSidebar } from "@/layouts/NavigationSidebar";
import { SettingsSidebar } from "@/layouts/SettingsSidebar";
import { get_group_chat_key, get_session_key } from "@/lib/chat/chat_cache_key";
import type { ChatSubmitMode, DesktopController, NavigationTarget, SettingsSection } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopChatRewriteInput, DesktopGroupSummary, DesktopSessionConfiguration, DesktopSessionSummary, DesktopSettings, DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import { SessionView } from "@/views/SessionView";
import { SettingsView } from "@/views/SettingsView";
import { PluginView } from "@/views/PluginView";
import { PluginWorkspaceView } from "@/views/PluginWorkspaceView";
import { WelcomeView } from "@/views/WelcomeView";
import { CreateAgentView } from "@/views/CreateAgentView";
import { CreateGroupView } from "@/views/CreateGroupView";
import { WorkspaceInfoSidebar, WorkspaceView, type WorkspaceEditorField } from "@/views/WorkspaceView";
import { WorkspaceFileView } from "@/views/WorkspaceFileView";
import { MainViewBayBarFrame } from "@/layouts/BayBar";
import { GroupConfigView, GroupInfoSidebar, GroupView, type GroupEditorSection } from "@/views/GroupView";
import { AgentInfoSidebar, AgentView, type AgentEditorSection } from "@/views/AgentView";
import { MainViewHeaderProvider } from "@/layouts/MainViewLayout";
import { ShellSidebarControl } from "@/layouts/ShellSidebarControl";
import { resolve_desktop_link } from "@/lib/link/desktop_link";
import { TurnFileDiffReviewHost } from "@/lib/chat/assistant/TurnFileDiffCard";
import { create_chat_composer } from "@/lib/chat/editor/chatComposerCodec";

const empty_items: never[] = [];
const empty_chat_content = create_chat_composer();

/** 为 Registry 尚未完成同步的 Session 提供最小 Workspace 展示值。 */
function create_missing_workspace(workspace_id: string): DesktopWorkspaceSummary {
  return { workspace_id, workspace_path: "", name: workspace_id, readme: "", created_at: "", updated_at: "" };
}

/** Desktop 根组件。 */
export function App() {
  const controller = use_desktop_controller();
  const current_selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const stable_controller = useMemo<DesktopController>(() => ({
    stores: controller.stores,
    actions: controller.actions,
  }), [controller.actions, controller.stores]);
  const [create_workspace_dialog_open, set_create_workspace_dialog_open] = useState(false);
  const [sidebar_collapsed, set_sidebar_collapsed] = useState(false);
  const [command_palette_open, set_command_palette_open] = useState(false);
  const open_group_from_sidebar = useCallback((group_id: string) => controller.actions.select_group(group_id), [controller.actions]);
  const open_create_workspace = useCallback(() => set_create_workspace_dialog_open(true), []);

  useEffect(() => {
    const handle_key_down = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "b") {
        event.preventDefault();
        set_sidebar_collapsed((value) => !value);
        return;
      }
      if (modifier && (event.key.toLowerCase() === "l" || event.key.toLowerCase() === "i")) {
        event.preventDefault();
        const input = document.querySelector<HTMLElement>("[data-chat-input='true']");
        input?.focus();
        return;
      }
      if (modifier && event.key === ",") {
        event.preventDefault();
        stable_controller.actions.open_settings("user");
        return;
      }
      const navigation = stable_controller.stores.navigation.get_snapshot();
      if (event.key === "Escape" && navigation.selection?.kind === "settings") {
        event.preventDefault();
        stable_controller.actions.close_settings();
        return;
      }
      if (modifier && event.key.toLowerCase() === "p") {
        event.preventDefault();
        set_command_palette_open(true);
        return;
      }
      if (modifier && event.key.toLowerCase() === "r") {
        event.preventDefault();
        const group_id = navigation.selection && "group_id" in navigation.selection ? navigation.selection.group_id : undefined;
        if (group_id && navigation.active_workspace_id) {
          void stable_controller.actions.create_group_session(group_id, navigation.active_workspace_id);
          return;
        }
        const agent_id = navigation.selection && "agent_id" in navigation.selection ? navigation.selection.agent_id : stable_controller.stores.catalog.get_snapshot().agents[0]?.agent_id;
        if (agent_id && navigation.active_workspace_id) void stable_controller.actions.create_session(navigation.active_workspace_id, agent_id);
      }
    };
    window.addEventListener("keydown", handle_key_down, true);
    return () => window.removeEventListener("keydown", handle_key_down, true);
  }, [stable_controller]);

  useEffect(() => {
    const handle_link_click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      const target = anchor?.getAttribute("href");
      if (!target) return;
      const navigation = stable_controller.stores.navigation.get_snapshot();
      const selection = navigation.selection;
      const context = selection?.kind === "workspace_file"
        ? { workspace_id: selection.workspace_id, relative_path: selection.relative_path }
        : selection && "workspace_id" in selection ? { workspace_id: selection.workspace_id } : { workspace_id: navigation.active_workspace_id || undefined };
      const action = resolve_desktop_link(target, stable_controller.stores.catalog.get_snapshot().workspaces, context);
      if (action.kind === "ignore") return;
      event.preventDefault();
      if (action.kind === "blocked") return;
      if (action.kind === "workspace_file") {
        stable_controller.actions.select_workspace_file(action.workspace_id, action.relative_path);
        return;
      }
      const opening = action.kind === "external_url"
        ? window.downcity.system.open_external_url(action.url)
        : window.downcity.system.open_local_file(action.file_path);
      void opening.catch((reason: unknown) => console.error("打开链接失败", reason));
    };
    document.addEventListener("click", handle_link_click);
    return () => document.removeEventListener("click", handle_link_click);
  }, [stable_controller]);

  return <div className="fixed inset-0 flex h-full min-h-0 w-full overflow-hidden bg-muted">
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden">
      {current_selection?.kind === "settings"
        ? <SettingsSidebar controller={stable_controller} collapsed={sidebar_collapsed} />
        : <NavigationSidebar
          controller={stable_controller}
          open_create_agent={controller.actions.open_create_agent}
          open_create_group={controller.actions.open_create_group}
          open_create_workspace={open_create_workspace}
          open_group_config={open_group_from_sidebar}
          collapsed={sidebar_collapsed}
        />}
      <main className="main-view-shell relative flex h-full min-w-0 flex-1 bg-background">
        <TurnFileDiffReviewHost><MainViewHeaderProvider value={{ sidebar_collapsed, baybar_available: false, baybar_open: false }}><div className="flex h-full min-w-0 flex-1 flex-col"><DesktopMainView selection={current_selection} controller={stable_controller} sidebar_collapsed={sidebar_collapsed} /></div></MainViewHeaderProvider></TurnFileDiffReviewHost>
      </main>
    </div>
    <ShellSidebarControl collapsed={sidebar_collapsed} toggle_sidebar={() => set_sidebar_collapsed((value) => !value)} />
    <DesktopErrorHost controller={stable_controller} />
    <CreateWorkspaceDialog open={create_workspace_dialog_open} close_dialog={() => set_create_workspace_dialog_open(false)} create_workspace={controller.actions.create_workspace} />
    <SessionAttachHost controller={stable_controller} />
    {command_palette_open ? <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[18vh]" onMouseDown={() => set_command_palette_open(false)}><div className="w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover p-2 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { set_command_palette_open(false); controller.actions.open_settings("user"); }}>打开设置 <span className="ml-auto text-xs text-muted-foreground">⌘,</span></button><button type="button" className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { set_command_palette_open(false); set_sidebar_collapsed((value) => !value); }}>切换左侧边栏 <span className="ml-auto text-xs text-muted-foreground">⌘B</span></button></div></div> : null}
  </div>;
}

/** 业务主视图订阅自己需要的 Catalog、Session 与设置切片，不把变化传播到应用壳。 */
function DesktopMainView({ selection, controller, sidebar_collapsed }: { /** 当前导航目标。 */ selection: NavigationTarget | null; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const workspaces = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces);
  const groups = use_desktop_selector(controller.stores.catalog, (state) => state.groups);
  const plugins = use_desktop_selector(controller.stores.catalog, (state) => state.plugins);
  const models = use_desktop_selector(controller.stores.catalog, (state) => state.models);
  const models_loading = use_desktop_selector(controller.stores.catalog, (state) => state.models_loading);
  const sessions_by_workspace = use_desktop_selector(controller.stores.session, (state) => state.sessions_by_workspace);
  const settings = use_desktop_selector(controller.stores.settings, (state) => state.settings);
  const selected_agent = selection?.kind === "agent" || selection?.kind === "session" || selection?.kind === "draft"
    ? agents.find((agent) => agent.agent_id === selection.agent_id)
    : undefined;

  if (selection?.kind === "create_agent") return <CreateAgentView models={models} models_loading={models_loading} default_model_id={settings.default_text_model_id} plugins={plugins} create_agent={controller.actions.create_agent} />;
  if (selection?.kind === "create_group") return <CreateGroupView agents={agents} models={models} models_loading={models_loading} default_model_id={settings.default_text_model_id} create_group={controller.actions.create_group} />;
  if (selection?.kind === "settings") return <SettingsMainView key={`settings:${selection.section}`} controller={controller} section={selection.section} sidebar_collapsed={sidebar_collapsed} />;
  if (selection?.kind === "plugin") {
    const plugin = plugins.find((item) => item.plugin_id === selection.plugin_id);
    return plugin ? <PluginView plugin={plugin} controller={controller.actions} /> : <WelcomeView />;
  }
  if (selection?.kind === "plugin_workspace") {
    const plugin = plugins.find((item) => item.plugin_id === selection.plugin_id);
    return plugin?.has_sidebar && plugin.has_mainview ? <PluginWorkspaceView plugin={plugin} controller={controller} /> : <WelcomeView />;
  }
  if (selection?.kind === "workspace") {
    const workspace = workspaces.find((item) => item.workspace_id === selection.workspace_id);
    return workspace ? <WorkspaceMainView workspace={workspace} controller={controller} sidebar_collapsed={sidebar_collapsed} /> : <WelcomeView />;
  }
  if (selection?.kind === "workspace_file") {
    const workspace = workspaces.find((item) => item.workspace_id === selection.workspace_id);
    return workspace ? <WorkspaceFileView workspace={workspace} relative_path={selection.relative_path} /> : <WelcomeView />;
  }
  if (selection?.kind === "group_session" || selection?.kind === "group_draft") {
    const group = groups.find((item) => item.group_id === selection.group_id);
    const session_id = selection.kind === "group_draft" ? selection.draft_id : selection.session_id;
    const session = selection.kind === "group_draft"
      ? { session_id, title: "新对话", workspace_id: selection.workspace_id, created_at: 0, updated_at: 0, message_count: 0 }
      : group?.sessions.find((item) => item.session_id === session_id);
    if (!group || !session) return <WelcomeView />;
    return <GroupChatMainView group={group} controller={controller} sidebar_collapsed={sidebar_collapsed} view_key={`group-chat:${group.group_id}:${session_id}`}>
      {(open_group_info) => <GroupChatSurface selection={selection} group={group} session={session} open_group_info={open_group_info} workspaces={workspaces} agents={agents} settings={settings} controller={controller} />}
    </GroupChatMainView>;
  }
  if (selection?.kind === "group") {
    const group = groups.find((item) => item.group_id === selection.group_id);
    return group ? <GroupMainView key={`group:${group.group_id}`} group={group} controller={controller} sidebar_collapsed={sidebar_collapsed} /> : <WelcomeView />;
  }
  if (!selection || !selected_agent) return <WelcomeView />;
  if (selection.kind === "agent") {
    const main_context = settings.agent_main_sessions[selected_agent.agent_id];
    const main_session = main_context
      ? (sessions_by_workspace[main_context.workspace_id] ?? []).find((item) => item.agent_id === selected_agent.agent_id && item.session.session_id === main_context.session_id)
      : undefined;
    return <AgentMainView key={`agent:${selected_agent.agent_id}`} agent={selected_agent} controller={controller} sidebar_collapsed={sidebar_collapsed} main_session={main_session ? { workspace_id: main_context!.workspace_id, session: main_session.session } : undefined} />;
  }
  if (selection.kind === "draft") {
    return <AgentChatMainView agent={selected_agent} controller={controller} sidebar_collapsed={sidebar_collapsed} view_key={`agent-draft:${selected_agent.agent_id}:${selection.draft_id}`}>
      {(open_agent_info) => <AgentDraftChatSurface selection={selection} agent={selected_agent} open_agent_info={open_agent_info} workspaces={workspaces} agents={agents} settings={settings} models={models} models_loading={models_loading} controller={controller} />}
    </AgentChatMainView>;
  }
  if (selection.kind !== "session") return <WelcomeView />;
  const session = (sessions_by_workspace[selection.workspace_id] ?? []).find((item) => item.agent_id === selected_agent.agent_id && item.session.session_id === selection.session_id)?.session;
  if (!session) return <WelcomeView />;
  return <AgentChatMainView agent={selected_agent} controller={controller} sidebar_collapsed={sidebar_collapsed} view_key={`agent-session:${selected_agent.agent_id}:${session.session_id}`}>
    {(open_agent_info) => <AgentSessionChatSurface selection={selection} agent={selected_agent} session={session} open_agent_info={open_agent_info} workspaces={workspaces} agents={agents} settings={settings} models={models} models_loading={models_loading} controller={controller} />}
  </AgentChatMainView>;
}

/** 全局错误只订阅错误文本，避免设置其它字段变化刷新应用壳。 */
function DesktopErrorHost({ controller }: { /** Desktop 稳定控制器。 */ controller: DesktopController }) {
  const error = use_desktop_selector(controller.stores.settings, (state) => state.error);
  return error ? createPortal(<div className="fixed bottom-5 left-1/2 z-[60] flex max-w-xl -translate-x-1/2 items-start gap-3 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-xl"><span className="min-w-0 flex-1 break-words">{error}</span><Button onClick={controller.actions.clear_error}>关闭</Button></div>, document.body) : null;
}

/** 孤儿 Session 绑定弹窗独立订阅请求与 Workspace 列表。 */
function SessionAttachHost({ controller }: { /** Desktop 稳定控制器。 */ controller: DesktopController }) {
  const request = use_desktop_selector(controller.stores.session, (state) => state.session_attach_request);
  const workspaces = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces);
  return <AttachSessionWorkspaceDialog request={request} workspaces={workspaces} close_dialog={controller.actions.clear_session_attach_request} rebind_session_workspace={controller.actions.rebind_session_workspace} create_workspace_for_session={controller.actions.create_workspace_for_session} />;
}

/** 无状态 Draft 能力使用的稳定空操作。 */
function ignore_action(): void {}

/** 无状态 Draft 能力使用的稳定异步空操作。 */
async function ignore_async_action(): Promise<void> {}

/** Agent Draft 只订阅自己的草稿与配置，不把输入更新传播到应用壳。 */
function AgentDraftChatSurface({ selection, agent, open_agent_info, workspaces, agents, settings, models, models_loading, controller }: { /** 当前 Draft 导航目标。 */ selection: Extract<NavigationTarget, { kind: "draft" }>; /** Draft 所属 Agent。 */ agent: DesktopAgentSummary; /** 打开 Agent 编辑侧栏。 */ open_agent_info(): void; /** 可用 Workspace。 */ workspaces: DesktopWorkspaceSummary[]; /** 可用 Agent。 */ agents: DesktopAgentSummary[]; /** Chat 设置。 */ settings: DesktopSettings; /** 可用模型。 */ models: Parameters<typeof SessionView>[0]["models"]; /** 模型读取状态。 */ models_loading: boolean; /** Desktop 稳定控制器。 */ controller: DesktopController }) {
  const { workspace_id, agent_id, draft_id } = selection;
  const session_key = get_session_key(workspace_id, agent_id, draft_id);
  const draft_content = use_desktop_selector(controller.stores.composer, (state) => state.draft_content_by_session[session_key]);
  const configuration = use_desktop_selector(controller.stores.chat_stream, (state) => state.configuration_by_session[session_key]);
  const draft_session = useMemo<DesktopSessionSummary>(() => ({ session_id: draft_id, session_path: "", title: "新对话", preview_text: "", created_at: 0, updated_at: 0, message_count: 0, executing: false }), [draft_id]);
  const switch_workspace = useCallback((target_workspace_id: string) => controller.actions.switch_draft_context(target_workspace_id, agent_id), [agent_id, controller.actions]);
  const update_draft = useCallback((input: JSONContent) => controller.actions.update_draft(workspace_id, agent_id, draft_id, input), [agent_id, controller.actions, draft_id, workspace_id]);
  const send_message = useCallback((input: JSONContent, mode?: ChatSubmitMode) => controller.actions.send_message(workspace_id, agent_id, draft_id, input, mode), [agent_id, controller.actions, draft_id, workspace_id]);
  const set_model = useCallback((model_id: string) => controller.actions.set_session_model(workspace_id, agent_id, draft_id, model_id), [agent_id, controller.actions, draft_id, workspace_id]);
  const set_reasoning_effort = useCallback((reasoning_effort?: string) => controller.actions.set_session_reasoning_effort(workspace_id, agent_id, draft_id, reasoning_effort), [agent_id, controller.actions, draft_id, workspace_id]);
  const set_approval_mode = useCallback((approval_mode: DesktopSessionConfiguration["approval_mode"]) => controller.actions.set_session_approval_mode(workspace_id, agent_id, draft_id, approval_mode), [agent_id, controller.actions, draft_id, workspace_id]);
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
    draft_content={draft_content ?? empty_chat_content}
    queued_messages={empty_items}
    queue_paused={false}
    settings={settings}
    switch_draft_context={controller.actions.switch_draft_context}
    models={models}
    configuration={configuration ?? { model_id: agent.model_id, approval_mode: "ask" }}
    models_loading={models_loading}
    update_draft={update_draft}
    send_message={send_message}
    refresh_models={controller.actions.refresh_models}
    set_model={set_model}
    set_reasoning_effort={set_reasoning_effort}
    set_approval_mode={set_approval_mode}
    stop_session={ignore_async_action}
    respond_interaction={ignore_async_action}
    fork_message={ignore_async_action}
    remove_queued_message={ignore_action}
    send_queued_message={ignore_async_action}
    update_queued_message={ignore_action}
    toggle_queued_message_paused={ignore_action}
    set_queue_paused={ignore_action}
    move_queued_message={ignore_action}
    load_earlier_history={ignore_async_action}
  />;
}

/** 已创建 Agent Session 的高频状态消费边界。 */
function AgentSessionChatSurface({ selection, agent, session, open_agent_info, workspaces, agents, settings, models, models_loading, controller }: { /** 当前 Session 导航目标。 */ selection: Extract<NavigationTarget, { kind: "session" }>; /** Session 所属 Agent。 */ agent: DesktopAgentSummary; /** 当前 Session 摘要。 */ session: DesktopSessionSummary; /** 打开 Agent 编辑侧栏。 */ open_agent_info(): void; /** 可用 Workspace。 */ workspaces: DesktopWorkspaceSummary[]; /** 可用 Agent。 */ agents: DesktopAgentSummary[]; /** Chat 设置。 */ settings: DesktopSettings; /** 可用模型。 */ models: Parameters<typeof SessionView>[0]["models"]; /** 模型读取状态。 */ models_loading: boolean; /** Desktop 稳定控制器。 */ controller: DesktopController }) {
  const { workspace_id, agent_id, session_id } = selection;
  const session_key = get_session_key(workspace_id, agent_id, session_id);
  const messages = use_desktop_selector(controller.stores.chat_stream, (state) => state.messages_by_session[session_key]);
  const runtime = use_desktop_selector(controller.stores.chat_stream, (state) => state.chat_runtime_by_session[session_key]);
  const file_diff = use_desktop_selector(controller.stores.chat_stream, (state) => state.file_diff_by_session[session_key]);
  const configuration = use_desktop_selector(controller.stores.chat_stream, (state) => state.configuration_by_session[session_key]);
  const history = use_desktop_selector(controller.stores.chat_stream, (state) => state.history_by_session[session_key]);
  const draft_content = use_desktop_selector(controller.stores.composer, (state) => state.draft_content_by_session[session_key]);
  const queued_messages = use_desktop_selector(controller.stores.composer, (state) => state.queued_messages_by_session[session_key]);
  const queue_paused = use_desktop_selector(controller.stores.composer, (state) => state.queue_paused_by_session[session_key]);
  const switch_workspace = useCallback((target_workspace_id: string) => controller.actions.create_session(target_workspace_id, agent_id), [agent_id, controller.actions]);
  const rename_session = useCallback((title: string) => controller.actions.rename_session(workspace_id, agent_id, session_id, title), [agent_id, controller.actions, session_id, workspace_id]);
  const archive_session = useCallback(() => controller.actions.archive_session(workspace_id, agent_id, session_id), [agent_id, controller.actions, session_id, workspace_id]);
  const remove_session = useCallback(() => controller.actions.remove_session(workspace_id, agent_id, session_id), [agent_id, controller.actions, session_id, workspace_id]);
  const update_draft = useCallback((input: JSONContent) => controller.actions.update_draft(workspace_id, agent_id, session_id, input), [agent_id, controller.actions, session_id, workspace_id]);
  const send_message = useCallback((input: JSONContent, mode?: ChatSubmitMode) => controller.actions.send_message(workspace_id, agent_id, session_id, input, mode), [agent_id, controller.actions, session_id, workspace_id]);
  const compact_session = useCallback(() => controller.actions.compact_session(workspace_id, agent_id, session_id), [agent_id, controller.actions, session_id, workspace_id]);
  const set_model = useCallback((model_id: string) => controller.actions.set_session_model(workspace_id, agent_id, session_id, model_id), [agent_id, controller.actions, session_id, workspace_id]);
  const set_reasoning_effort = useCallback((reasoning_effort?: string) => controller.actions.set_session_reasoning_effort(workspace_id, agent_id, session_id, reasoning_effort), [agent_id, controller.actions, session_id, workspace_id]);
  const set_approval_mode = useCallback((approval_mode: DesktopSessionConfiguration["approval_mode"]) => controller.actions.set_session_approval_mode(workspace_id, agent_id, session_id, approval_mode), [agent_id, controller.actions, session_id, workspace_id]);
  const stop_session = useCallback(() => controller.actions.stop_session(workspace_id, agent_id, session_id), [agent_id, controller.actions, session_id, workspace_id]);
  const respond_interaction = useCallback((input: RespondSessionInteractionInput) => controller.actions.respond_interaction(workspace_id, agent_id, session_id, input), [agent_id, controller.actions, session_id, workspace_id]);
  const fork_message = useCallback((message_id: string) => controller.actions.fork_session(workspace_id, agent_id, session_id, message_id), [agent_id, controller.actions, session_id, workspace_id]);
  const rewrite_message = useCallback((input: DesktopChatRewriteInput) => controller.actions.rewrite_session_message(workspace_id, agent_id, session_id, input), [agent_id, controller.actions, session_id, workspace_id]);
  const remove_queued_message = useCallback((message_id: string) => controller.actions.remove_queued_message(workspace_id, agent_id, session_id, message_id), [agent_id, controller.actions, session_id, workspace_id]);
  const send_queued_message = useCallback((message_id: string) => controller.actions.send_queued_message(workspace_id, agent_id, session_id, message_id), [agent_id, controller.actions, session_id, workspace_id]);
  const update_queued_message = useCallback((message_id: string, text: string) => controller.actions.update_queued_message(workspace_id, agent_id, session_id, message_id, text), [agent_id, controller.actions, session_id, workspace_id]);
  const toggle_queued_message_paused = useCallback((message_id: string) => controller.actions.toggle_queued_message_paused(workspace_id, agent_id, session_id, message_id), [agent_id, controller.actions, session_id, workspace_id]);
  const set_queue_paused = useCallback((paused: boolean) => controller.actions.set_queue_paused(workspace_id, agent_id, session_id, paused), [agent_id, controller.actions, session_id, workspace_id]);
  const move_queued_message = useCallback((message_id: string, direction: "up" | "down") => controller.actions.move_queued_message(workspace_id, agent_id, session_id, message_id, direction), [agent_id, controller.actions, session_id, workspace_id]);
  const load_earlier_history = useCallback(() => controller.actions.load_earlier_history(workspace_id, agent_id, session_id), [agent_id, controller.actions, session_id, workspace_id]);
  return <SessionView
    chat_surface="agent"
    open_agent_info={open_agent_info}
    open_workspace_file={controller.actions.select_workspace_file}
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
    draft_content={draft_content ?? empty_chat_content}
    queued_messages={queued_messages ?? empty_items}
    queue_paused={queue_paused ?? false}
    history={history}
    settings={settings}
    rename_session={rename_session}
    archive_session={archive_session}
    remove_session={remove_session}
    switch_draft_context={controller.actions.switch_draft_context}
    models={models}
    configuration={configuration}
    models_loading={models_loading}
    update_draft={update_draft}
    send_message={send_message}
    compact_session={compact_session}
    refresh_models={controller.actions.refresh_models}
    set_model={set_model}
    set_reasoning_effort={set_reasoning_effort}
    set_approval_mode={set_approval_mode}
    stop_session={stop_session}
    respond_interaction={respond_interaction}
    fork_message={fork_message}
    rewrite_message={rewrite_message}
    remove_queued_message={remove_queued_message}
    send_queued_message={send_queued_message}
    update_queued_message={update_queued_message}
    toggle_queued_message_paused={toggle_queued_message_paused}
    set_queue_paused={set_queue_paused}
    move_queued_message={move_queued_message}
    load_earlier_history={load_earlier_history}
  />;
}

/** Group Chat 的消息、状态和草稿消费边界。 */
function GroupChatSurface({ selection, group, session, open_group_info, workspaces, agents, settings, controller }: { /** 当前 Group Chat 导航目标。 */ selection: Extract<NavigationTarget, { kind: "group_session" | "group_draft" }>; /** 当前 Group。 */ group: DesktopGroupSummary; /** 当前 Group Session 摘要。 */ session: DesktopGroupSummary["sessions"][number]; /** 打开 Group 编辑侧栏。 */ open_group_info(): void; /** 可用 Workspace。 */ workspaces: DesktopWorkspaceSummary[]; /** 可用 Agent。 */ agents: DesktopAgentSummary[]; /** Chat 设置。 */ settings: DesktopSettings; /** Desktop 稳定控制器。 */ controller: DesktopController }) {
  const session_id = selection.kind === "group_draft" ? selection.draft_id : selection.session_id;
  const group_id = selection.group_id;
  const workspace_id = selection.workspace_id;
  const chat_key = get_group_chat_key(workspace_id, group_id, session_id);
  const messages = use_desktop_selector(controller.stores.chat_stream, (state) => state.group_messages_by_group[group_id]);
  const member_statuses = use_desktop_selector(controller.stores.chat_stream, (state) => state.group_member_statuses_by_group[group_id]);
  const group_phase = use_desktop_selector(controller.stores.chat_stream, (state) => state.group_phase_by_group[group_id]);
  const read_message_ids = use_desktop_selector(controller.stores.chat_stream, (state) => state.group_read_message_ids_by_group[group_id]);
  const interactions = use_desktop_selector(controller.stores.chat_stream, (state) => state.group_interactions_by_group[group_id]);
  const draft_content = use_desktop_selector(controller.stores.composer, (state) => state.draft_content_by_session[chat_key]);
  const switch_workspace = useCallback((target_workspace_id: string) => selection.kind === "group_draft" ? controller.actions.switch_group_draft_context(group_id, target_workspace_id) : controller.actions.create_group_session(group_id, target_workspace_id), [controller.actions, group_id, selection.kind]);
  const respond_interaction = useCallback((input: RespondSessionInteractionInput) => selection.kind === "group_session" ? controller.actions.respond_group_interaction(group_id, selection.session_id, input) : Promise.resolve(), [controller.actions, group_id, selection]);
  const update_draft = useCallback((input: JSONContent) => controller.actions.update_group_draft(workspace_id, group_id, session_id, input), [controller.actions, group_id, session_id, workspace_id]);
  const send_message = useCallback((target_session_id: string, input: JSONContent) => controller.actions.send_group_message(group_id, workspace_id, target_session_id, input), [controller.actions, group_id, workspace_id]);
  const stop_session = useCallback((target_session_id: string) => selection.kind === "group_session" ? controller.actions.stop_group(group_id, target_session_id) : Promise.resolve(), [controller.actions, group_id, selection.kind]);
  const remove_session = useMemo(() => selection.kind === "group_session" ? () => controller.actions.remove_group_session(group_id, selection.session_id) : undefined, [controller.actions, group_id, selection]);
  return <GroupView
    group={group}
    open_group_info={open_group_info}
    workspace_id={workspace_id}
    workspaces={workspaces}
    workspace_draft_mode={selection.kind === "group_draft"}
    switch_workspace={switch_workspace}
    session={session}
    agents={agents}
    settings={settings}
    messages={selection.kind === "group_draft" ? empty_items : messages ?? empty_items}
    member_statuses={member_statuses ?? empty_items}
    group_phase={group_phase ?? "idle"}
    read_message_ids={read_message_ids ?? empty_items}
    interactions={interactions ?? empty_items}
    respond_interaction={respond_interaction}
    controller={controller}
    draft_content={draft_content ?? empty_chat_content}
    update_draft={update_draft}
    send_message={send_message}
    stop_session={stop_session}
    remove_session={remove_session}
  />;
}

/** Workspace MainView 独立拥有配置 BayBar 的分区编辑侧栏。 */
function WorkspaceMainView({ workspace, controller, sidebar_collapsed }: { /** 当前 Workspace。 */ workspace: DesktopWorkspaceSummary; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const [section, set_section] = useState<WorkspaceEditorField>("identity");
  const titles: Record<WorkspaceEditorField, string> = { identity: "基本信息", readme: "README.md" };
  const baybar_content = <div className="flex h-full min-h-0 flex-col"><nav className="flex shrink-0 gap-1 border-b border-border/45 p-2" aria-label="Workspace 编辑分区">{(["identity", "readme"] as const).map((item) => <button key={item} type="button" onClick={() => set_section(item)} className={`rounded-md px-2 py-1 text-[0.6875rem] transition-colors duration-150 ${section === item ? "bg-interaction-selected text-foreground" : "text-muted-foreground hover:bg-interaction-hover hover:text-foreground"}`}>{titles[item]}</button>)}</nav><div className="min-h-0 flex-1 overflow-y-auto"><WorkspaceInfoSidebar workspace={workspace} controller={controller.actions} section={section} embedded close_sidebar={() => undefined} /></div></div>;
  return <MainViewBayBarFrame view_key={`workspace:${workspace.workspace_id}`} sidebar_collapsed={sidebar_collapsed} title={titles[section]} baybar_content={baybar_content}>
    {(open_baybar) => <WorkspaceView workspace={workspace} open_editor={(field) => { set_section(field); open_baybar(); }} />}
  </MainViewBayBarFrame>;
}

/** Agent MainView 独立拥有配置 BayBar 的状态与编辑分区。 */
function AgentMainView({ agent, controller, sidebar_collapsed, main_session }: { /** 当前 Agent。 */ agent: DesktopAgentSummary; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean; /** Agent 主对话。 */ main_session?: { workspace_id: string; session: DesktopSessionSummary } }) {
  const [section, set_section] = useState<AgentEditorSection>("model");
  const workspaces = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces);
  const plugins = use_desktop_selector(controller.stores.catalog, (state) => state.plugins);
  return <MainViewBayBarFrame view_key={`agent:${agent.agent_id}`} sidebar_collapsed={sidebar_collapsed} title={section === "identity" ? "身份" : section === "model" ? "Model" : section === "soul" ? "SOUL.md" : "Plugins"} baybar_content={<AgentInfoSidebar agent={agent} plugins={plugins} controller={controller} section={section} embedded close_sidebar={() => undefined} />}>
    {(open_baybar) => <AgentView agent={agent} workspaces={workspaces} plugins={plugins} main_session={main_session} controller={controller} open_main_session={() => controller.actions.open_agent_chat(agent.agent_id)} open_config={(next_section) => { set_section(next_section); open_baybar(); }} />}
  </MainViewBayBarFrame>;
}

/** Agent Chat 独立持有完整 Agent 编辑 BayBar。 */
function AgentChatMainView({ agent, controller, sidebar_collapsed, view_key, children }: { /** 当前 Agent。 */ agent: DesktopAgentSummary; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean; /** 当前 Chat 的稳定标识。 */ view_key: string; /** 渲染 Chat 并接收编辑入口。 */ children(open_agent_info: () => void): ReactNode }) {
  const [section, set_section] = useState<AgentEditorSection>("identity");
  const plugins = use_desktop_selector(controller.stores.catalog, (state) => state.plugins);
  const titles: Record<AgentEditorSection, string> = { identity: "身份", model: "Model", soul: "SOUL.md", plugins: "Plugins" };
  const baybar_content = <div className="flex h-full min-h-0 flex-col"><nav className="flex shrink-0 gap-1 border-b border-border/45 p-2" aria-label="Agent 编辑分区">{(["identity", "model", "soul", "plugins"] as const).map((item) => <button key={item} type="button" onClick={() => set_section(item)} className={`rounded-md px-2 py-1 text-[0.6875rem] transition-colors duration-150 ${section === item ? "bg-interaction-selected text-foreground" : "text-muted-foreground hover:bg-interaction-hover hover:text-foreground"}`}>{titles[item]}</button>)}</nav><div className="min-h-0 flex-1 overflow-y-auto"><AgentInfoSidebar agent={agent} plugins={plugins} controller={controller} section={section} embedded close_sidebar={() => undefined} /></div></div>;
  return <MainViewBayBarFrame view_key={view_key} sidebar_collapsed={sidebar_collapsed} title={titles[section]} baybar_content={baybar_content}>
    {children}
  </MainViewBayBarFrame>;
}

/** Group MainView 独立拥有配置 BayBar 的状态与编辑分区。 */
function GroupMainView({ group, controller, sidebar_collapsed }: { /** 当前 Group。 */ group: DesktopGroupSummary; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const [section, set_section] = useState<GroupEditorSection>("model");
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  return <MainViewBayBarFrame view_key={`group:${group.group_id}`} sidebar_collapsed={sidebar_collapsed} title={section === "model" ? "Model" : section === "instruction" ? "协作目标" : "成员"} baybar_content={<GroupInfoSidebar group={group} agents={agents} controller={controller} section={section} embedded close_sidebar={() => undefined} />}>
    {(open_baybar) => <GroupConfigView group={group} agents={agents} open_config={(next_section) => { set_section(next_section); open_baybar(); }} />}
  </MainViewBayBarFrame>;
}

/** Group Chat 独立持有完整 Group 编辑 BayBar。 */
function GroupChatMainView({ group, controller, sidebar_collapsed, view_key, children }: { /** 当前 Group。 */ group: DesktopGroupSummary; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean; /** 当前 Chat 的稳定标识。 */ view_key: string; /** 渲染 Chat 并接收编辑入口。 */ children(open_group_info: () => void): ReactNode }) {
  const [section, set_section] = useState<GroupEditorSection>("model");
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const titles: Record<GroupEditorSection, string> = { model: "Model", instruction: "协作目标", members: "成员" };
  const baybar_content = <div className="flex h-full min-h-0 flex-col"><nav className="flex shrink-0 gap-1 border-b border-border/45 p-2" aria-label="Group 编辑分区">{(["model", "instruction", "members"] as const).map((item) => <button key={item} type="button" onClick={() => set_section(item)} className={`rounded-md px-2 py-1 text-[0.6875rem] transition-colors duration-150 ${section === item ? "bg-interaction-selected text-foreground" : "text-muted-foreground hover:bg-interaction-hover hover:text-foreground"}`}>{titles[item]}</button>)}</nav><div className="min-h-0 flex-1 overflow-y-auto"><GroupInfoSidebar group={group} agents={agents} controller={controller} section={section} embedded close_sidebar={() => undefined} /></div></div>;
  return <MainViewBayBarFrame view_key={view_key} sidebar_collapsed={sidebar_collapsed} title={titles[section]} baybar_content={baybar_content}>{children}</MainViewBayBarFrame>;
}

/** Settings MainView 仅在 General 页面拥有自己的 Global Env BayBar。 */
function SettingsMainView({ controller, section, sidebar_collapsed }: { /** Desktop 稳定控制器。 */ controller: DesktopController; /** 当前设置分区。 */ section: SettingsSection; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  if (section !== "general") return <SettingsView controller={controller} section={section} open_global_env={() => undefined} />;
  return <MainViewBayBarFrame view_key="settings:general" sidebar_collapsed={sidebar_collapsed} title="Global Env" baybar_content={<GlobalEnvEditor controller={controller} />}>
    {(open_baybar) => <SettingsView controller={controller} section={section} open_global_env={() => { void controller.actions.list_global_env(); open_baybar(); }} />}
  </MainViewBayBarFrame>;
}

/** BayBar 中的 Global Env 原文编辑器。 */
function GlobalEnvEditor({ controller }: { controller: DesktopController }) {
  const global_env = use_desktop_selector(controller.stores.settings, (state) => state.global_env);
  const [draft, set_draft] = useState(global_env);
  const [saving, set_saving] = useState(false);
  useEffect(() => set_draft(global_env), [global_env]);
  const save = async () => { set_saving(true); try { await controller.actions.update_global_env(draft); } finally { set_saving(false); } };
  return <div className="flex h-full min-h-0 flex-col p-3"><textarea className="min-h-0 flex-1 resize-none bg-transparent font-mono text-xs leading-6 text-foreground outline-none" value={draft} onChange={(event) => set_draft(event.target.value)} spellCheck={false} aria-label="Global Env" /><div className="flex justify-end pt-3"><Button variant="primary" disabled={saving || draft === global_env} onClick={() => void save()}>{saving ? "保存中" : "保存"}</Button></div></div>;
}
