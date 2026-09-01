/** Downcity Desktop 根应用壳，直接沿用 Duobox 的 Sidebar + MainView 结构。 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CreateAgentDialog } from "@/components/CreateAgentDialog";
import { CreateWorkspaceDialog } from "@/components/CreateWorkspaceDialog";
import { Button } from "@/components/ui/button";
import { use_desktop_controller } from "@/hooks/use_desktop_controller";
import { NavigationSidebar } from "@/layouts/NavigationSidebar";
import { SettingsSidebar } from "@/layouts/SettingsSidebar";
import { get_session_key } from "@/types/DesktopView";
import type { SettingsSection } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopGroupSummary, DesktopSessionSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import { SessionView } from "@/views/SessionView";
import { SettingsView } from "@/views/SettingsView";
import { PluginView } from "@/views/PluginView";
import { PluginWorkspaceView } from "@/views/PluginWorkspaceView";
import { WelcomeView } from "@/views/WelcomeView";
import { WorkspaceIdentityEditor, WorkspaceView, type WorkspaceEditorField } from "@/views/WorkspaceView";
import { WorkspaceFileView } from "@/views/WorkspaceFileView";
import { MainViewBayBarFrame } from "@/layouts/BayBar";
import { GroupConfigView, GroupInfoSidebar, GroupView, type GroupEditorSection } from "@/views/GroupView";
import { AgentInfoSidebar, AgentView, type AgentEditorSection } from "@/views/AgentView";
import { MainViewHeaderProvider } from "@/layouts/MainViewLayout";
import { AgentChatSessionSidebar, GroupChatSessionSidebar } from "@/layouts/ChatSessionSidebar";
import { ShellSidebarControl } from "@/layouts/ShellSidebarControl";
import { resolve_desktop_link } from "@/lib/link/desktop_link";

/** 为 Registry 尚未完成同步的 Session 提供最小 Workspace 展示值。 */
function create_missing_workspace(workspace_id: string): DesktopWorkspaceSummary {
  return { workspace_id, workspace_path: "", name: workspace_id, readme: "", created_at: "", updated_at: "" };
}

/** Desktop 根组件。 */
export function App() {
  const controller = use_desktop_controller();
  const [create_dialog_open, set_create_dialog_open] = useState(false);
  const [create_workspace_dialog_open, set_create_workspace_dialog_open] = useState(false);
  const [create_workspace_id, set_create_workspace_id] = useState<string>();
  const [sidebar_collapsed, set_sidebar_collapsed] = useState(false);
  const [chat_session_sidebar_collapsed, set_chat_session_sidebar_collapsed] = useState(() => localStorage.getItem("downcity.chat_session_sidebar_collapsed") === "true");
  const [command_palette_open, set_command_palette_open] = useState(false);
  const open_group_from_sidebar = (group_id: string) => controller.select_group(group_id);
  const toggle_chat_session_sidebar = () => set_chat_session_sidebar_collapsed((current) => {
    localStorage.setItem("downcity.chat_session_sidebar_collapsed", String(!current));
    return !current;
  });
  const current_selection = controller.selection;
  const selected_agent = current_selection?.kind === "agent" || current_selection?.kind === "session" || current_selection?.kind === "draft"
    ? controller.agents.find((agent) => agent.agent_id === current_selection.agent_id)
    : undefined;

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
        controller.open_settings("user");
        return;
      }
      if (event.key === "Escape" && controller.selection?.kind === "settings") {
        event.preventDefault();
        controller.close_settings();
        return;
      }
      if (modifier && event.key.toLowerCase() === "p") {
        event.preventDefault();
        set_command_palette_open(true);
        return;
      }
      if (modifier && event.key.toLowerCase() === "r") {
        event.preventDefault();
        const agent_id = controller.selection && "agent_id" in controller.selection ? controller.selection.agent_id : controller.agents[0]?.agent_id;
        if (agent_id && controller.active_workspace_id) void controller.create_session(controller.active_workspace_id, agent_id);
      }
    };
    window.addEventListener("keydown", handle_key_down, true);
    return () => window.removeEventListener("keydown", handle_key_down, true);
  }, [controller]);

  useEffect(() => {
    const handle_link_click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      const target = anchor?.getAttribute("href");
      if (!target) return;
      const selection = controller.selection;
      const context = selection?.kind === "workspace_file"
        ? { workspace_id: selection.workspace_id, relative_path: selection.relative_path }
        : selection && "workspace_id" in selection ? { workspace_id: selection.workspace_id } : { workspace_id: controller.active_workspace_id || undefined };
      const action = resolve_desktop_link(target, controller.workspaces, context);
      if (action.kind === "ignore") return;
      event.preventDefault();
      if (action.kind === "blocked") return;
      if (action.kind === "workspace_file") {
        controller.select_workspace_file(action.workspace_id, action.relative_path);
        return;
      }
      const opening = action.kind === "external_url"
        ? window.downcity.system.open_external_url(action.url)
        : window.downcity.system.open_local_file(action.file_path);
      void opening.catch((reason: unknown) => console.error("打开链接失败", reason));
    };
    document.addEventListener("click", handle_link_click);
    return () => document.removeEventListener("click", handle_link_click);
  }, [controller]);

  const render_main_view = () => {
    if (controller.selection?.kind === "settings") return <SettingsMainView key={`settings:${controller.selection.section}`} controller={controller} section={controller.selection.section} sidebar_collapsed={sidebar_collapsed} />;
    if (controller.selection?.kind === "plugin") {
      const plugin_id = controller.selection.plugin_id;
      const plugin = controller.plugins.find((item) => item.plugin_id === plugin_id);
      return plugin ? <PluginView plugin={plugin} controller={controller} /> : <WelcomeView />;
    }
    if (controller.selection?.kind === "plugin_workspace") {
      const plugin_id = controller.selection.plugin_id;
      const plugin = controller.plugins.find((item) => item.plugin_id === plugin_id);
      return plugin?.has_sidebar && plugin.has_mainview ? <PluginWorkspaceView plugin={plugin} controller={controller} /> : <WelcomeView />;
    }
    if (controller.selection?.kind === "workspace") {
      const workspace_id = controller.selection.workspace_id;
      const workspace = controller.workspaces.find((item) => item.workspace_id === workspace_id);
      if (!workspace) return <WelcomeView />;
      return <WorkspaceMainView workspace={workspace} controller={controller} sidebar_collapsed={sidebar_collapsed} />;
    }
    if (controller.selection?.kind === "workspace_file") {
      const workspace_file_selection = controller.selection;
      const workspace = controller.workspaces.find((item) => item.workspace_id === workspace_file_selection.workspace_id);
      return workspace ? <WorkspaceFileView workspace={workspace} relative_path={workspace_file_selection.relative_path} /> : <WelcomeView />;
    }
    if (controller.selection?.kind === "group_session") {
      const group_selection = controller.selection;
      const group = controller.groups.find((item) => item.group_id === group_selection.group_id);
      const session = group?.sessions.find((item) => item.session_id === group_selection.session_id);
      if (!group || !session) return <WelcomeView />;
      return <GroupView
        group={group}
        workspace_id={group_selection.workspace_id}
        session={session}
        agents={controller.agents}
        settings={controller.settings}
        messages={controller.group_messages_by_group[group_selection.group_id] ?? []}
        member_statuses={controller.group_member_statuses_by_group[group_selection.group_id] ?? []}
        group_phase={controller.group_phase_by_group[group_selection.group_id] ?? "idle"}
        read_message_ids={controller.group_read_message_ids_by_group[group_selection.group_id] ?? []}
        interactions={controller.group_interactions_by_group[group_selection.group_id] ?? []}
        respond_interaction={(input) => controller.respond_group_interaction(group_selection.group_id, group_selection.session_id, input)}
        controller={controller}
        send_message={(session_id, text) => controller.send_group_message(group_selection.group_id, session_id, text)}
        stop_session={(session_id) => controller.stop_group(group_selection.group_id, session_id)}
        session_sidebar_collapsed={chat_session_sidebar_collapsed}
        toggle_session_sidebar={toggle_chat_session_sidebar}
        session_sidebar={<GroupChatSessionSidebar group={group} controller={controller} collapsed={chat_session_sidebar_collapsed} />}
      />;
    }
    if (controller.selection?.kind === "group") {
      const group_selection = controller.selection;
      const group = controller.groups.find((item) => item.group_id === group_selection.group_id);
      return group ? <GroupMainView key={`group:${group.group_id}`} group={group} controller={controller} sidebar_collapsed={sidebar_collapsed} session_sidebar_collapsed={chat_session_sidebar_collapsed} toggle_session_sidebar={toggle_chat_session_sidebar} /> : <WelcomeView />;
    }
    if (!controller.selection || !selected_agent) return <WelcomeView />;
    if (controller.selection.kind === "agent") {
      const main_context = controller.settings.agent_main_sessions[selected_agent.agent_id];
      const main_session = main_context
        ? (controller.sessions_by_workspace[main_context.workspace_id] ?? []).find((item) => item.agent_id === selected_agent.agent_id && item.session.session_id === main_context.session_id)
        : undefined;
      return <AgentMainView key={`agent:${selected_agent.agent_id}`} agent={selected_agent} controller={controller} sidebar_collapsed={sidebar_collapsed} session_sidebar_collapsed={chat_session_sidebar_collapsed} toggle_session_sidebar={toggle_chat_session_sidebar} main_session={main_session ? { workspace_id: main_context!.workspace_id, session: main_session.session } : undefined} />;
    }
    if (controller.selection.kind === "draft") {
      const draft_id = controller.selection.draft_id;
      const workspace_id = controller.selection.workspace_id;
      const draft_key = get_session_key(workspace_id, selected_agent.agent_id, draft_id);
      return <SessionView
        workspace_id={workspace_id}
        agent={selected_agent}
        workspace={controller.workspaces.find((workspace) => workspace.workspace_id === workspace_id) ?? create_missing_workspace(workspace_id)}
        workspaces={controller.workspaces}
        agents={controller.agents}
        session={{ session_id: draft_id, title: "新对话", preview_text: "", created_at: 0, updated_at: 0, message_count: 0, executing: false }}
        session_sidebar_collapsed={chat_session_sidebar_collapsed}
        toggle_session_sidebar={toggle_chat_session_sidebar}
        session_sidebar={<AgentChatSessionSidebar agent={selected_agent} controller={controller} collapsed={chat_session_sidebar_collapsed} />}
        messages={[]}
        draft={controller.drafts_by_session[draft_key] ?? ""}
        draft_files={controller.draft_files_by_session[draft_key] ?? []}
        draft_references={controller.draft_references_by_session[draft_key] ?? []}
        queued_messages={[]}
        settings={controller.settings}
        switch_draft_context={controller.switch_draft_context}
        models={controller.models}
        configuration={controller.configuration_by_session[draft_key] ?? { model_id: selected_agent.model_id, approval_mode: "ask" }}
        models_loading={controller.models_loading}
        update_draft={(text) => controller.update_draft(workspace_id, selected_agent.agent_id, draft_id, text)}
        update_draft_files={(files) => controller.update_draft_files(workspace_id, selected_agent.agent_id, draft_id, files)}
        update_draft_references={(references) => controller.update_draft_references(workspace_id, selected_agent.agent_id, draft_id, references)}
        send_message={(input) => controller.send_message(workspace_id, selected_agent.agent_id, draft_id, input)}
        refresh_models={controller.refresh_models}
        set_model={(model_id) => controller.set_session_model(workspace_id, selected_agent.agent_id, draft_id, model_id)}
        set_reasoning_effort={(effort) => controller.set_session_reasoning_effort(workspace_id, selected_agent.agent_id, draft_id, effort)}
        set_approval_mode={(approval_mode) => controller.set_session_approval_mode(workspace_id, selected_agent.agent_id, draft_id, approval_mode)}
        stop_session={async () => undefined}
        respond_interaction={async () => undefined}
        fork_message={async () => undefined}
        remove_queued_message={() => undefined}
        move_queued_message={() => undefined}
        load_earlier_history={async () => undefined}
      />;
    }
    if (controller.selection.kind !== "session") return <WelcomeView />;
    const selected_session_id = controller.selection.session_id;
    const workspace_id = controller.selection.workspace_id;
    const session = (controller.sessions_by_workspace[workspace_id] ?? []).find((item) => item.agent_id === selected_agent.agent_id && item.session.session_id === selected_session_id)?.session;
    if (!session) return <WelcomeView />;
    const session_key = get_session_key(
      workspace_id,
      selected_agent.agent_id,
      session.session_id,
    );
    return <SessionView
      chat_surface="agent"
      workspace_id={workspace_id}
      agent={selected_agent}
      workspace={controller.workspaces.find((workspace) => workspace.workspace_id === workspace_id) ?? create_missing_workspace(workspace_id)}
      workspaces={controller.workspaces}
        agents={controller.agents}
        session={session}
      session_sidebar_collapsed={chat_session_sidebar_collapsed}
      toggle_session_sidebar={toggle_chat_session_sidebar}
      session_sidebar={<AgentChatSessionSidebar agent={selected_agent} controller={controller} collapsed={chat_session_sidebar_collapsed} />}
      messages={controller.messages_by_session[session_key] ?? []}
      runtime={controller.chat_runtime_by_session[session_key]}
      draft={controller.drafts_by_session[session_key] ?? ""}
      draft_files={controller.draft_files_by_session[session_key] ?? []}
      draft_references={controller.draft_references_by_session[session_key] ?? []}
      queued_messages={controller.queued_messages_by_session[session_key] ?? []}
      history={controller.history_by_session[session_key]}
      settings={controller.settings}
      rename_session={(title) => controller.rename_session(workspace_id, selected_agent.agent_id, session.session_id, title)}
      archive_session={() => controller.archive_session(workspace_id, selected_agent.agent_id, session.session_id)}
      remove_session={() => controller.remove_session(workspace_id, selected_agent.agent_id, session.session_id)}
      switch_draft_context={controller.switch_draft_context}
      models={controller.models}
      configuration={controller.configuration_by_session[session_key]}
      models_loading={controller.models_loading}
      update_draft={(text) => controller.update_draft(workspace_id, selected_agent.agent_id, session.session_id, text)}
      update_draft_files={(files) => controller.update_draft_files(workspace_id, selected_agent.agent_id, session.session_id, files)}
      update_draft_references={(references) => controller.update_draft_references(workspace_id, selected_agent.agent_id, session.session_id, references)}
      send_message={(input) => controller.send_message(workspace_id, selected_agent.agent_id, session.session_id, input)}
      compact_session={() => controller.compact_session(workspace_id, selected_agent.agent_id, session.session_id)}
      refresh_models={controller.refresh_models}
      set_model={(model_id) => controller.set_session_model(workspace_id, selected_agent.agent_id, session.session_id, model_id)}
      set_reasoning_effort={(effort) => controller.set_session_reasoning_effort(workspace_id, selected_agent.agent_id, session.session_id, effort)}
      set_approval_mode={(approval_mode) => controller.set_session_approval_mode(workspace_id, selected_agent.agent_id, session.session_id, approval_mode)}
      stop_session={() => controller.stop_session(workspace_id, selected_agent.agent_id, session.session_id)}
      respond_interaction={(input) => controller.respond_interaction(workspace_id, selected_agent.agent_id, session.session_id, input)}
      fork_message={(message_id) => controller.fork_session(workspace_id, selected_agent.agent_id, session.session_id, message_id)}
      rewrite_message={(input) => controller.rewrite_session_message(workspace_id, selected_agent.agent_id, session.session_id, input)}
      remove_queued_message={(message_id) => controller.remove_queued_message(workspace_id, selected_agent.agent_id, session.session_id, message_id)}
      move_queued_message={(message_id, direction) => controller.move_queued_message(workspace_id, selected_agent.agent_id, session.session_id, message_id, direction)}
      load_earlier_history={() => controller.load_earlier_history(workspace_id, selected_agent.agent_id, session.session_id)}
    />;
  };

  return <div className="fixed inset-0 flex h-full min-h-0 w-full overflow-hidden bg-muted">
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden">
      {controller.selection?.kind === "settings"
        ? <SettingsSidebar controller={controller} collapsed={sidebar_collapsed} />
        : <NavigationSidebar
          controller={controller}
          open_create_agent={(workspace_id) => { set_create_workspace_id(workspace_id); set_create_dialog_open(true); }}
          open_create_workspace={() => set_create_workspace_dialog_open(true)}
          open_group_config={open_group_from_sidebar}
          collapsed={sidebar_collapsed}
        />}
      <main className="main-view-shell relative flex h-full min-w-0 flex-1 bg-background">
        <MainViewHeaderProvider value={{ sidebar_collapsed, baybar_available: false, baybar_open: false }}><div className="flex h-full min-w-0 flex-1 flex-col">{render_main_view()}</div></MainViewHeaderProvider>
      </main>
    </div>
    <ShellSidebarControl collapsed={sidebar_collapsed} toggle_sidebar={() => set_sidebar_collapsed((value) => !value)} />
    {controller.error ? createPortal(<div className="fixed bottom-5 left-1/2 z-[60] flex max-w-xl -translate-x-1/2 items-start gap-3 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-xl"><span className="min-w-0 flex-1 break-words">{controller.error}</span><Button onClick={controller.clear_error}>关闭</Button></div>, document.body) : null}
    <CreateAgentDialog open={create_dialog_open} close_dialog={() => { set_create_dialog_open(false); set_create_workspace_id(undefined); }} create_agent={controller.create_agent} models={controller.models} models_loading={controller.models_loading} default_model_id={controller.settings.default_text_model_id} workspace={controller.workspaces.find((workspace) => workspace.workspace_id === create_workspace_id)} />
    <CreateWorkspaceDialog open={create_workspace_dialog_open} close_dialog={() => set_create_workspace_dialog_open(false)} create_workspace={controller.create_workspace} />
    {command_palette_open ? <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[18vh]" onMouseDown={() => set_command_palette_open(false)}><div className="w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover p-2 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { set_command_palette_open(false); controller.open_settings("user"); }}>打开设置 <span className="ml-auto text-xs text-muted-foreground">⌘,</span></button><button type="button" className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { set_command_palette_open(false); set_sidebar_collapsed((value) => !value); }}>切换左侧边栏 <span className="ml-auto text-xs text-muted-foreground">⌘B</span></button></div></div> : null}
  </div>;
}

/** Workspace MainView 独立拥有配置 BayBar 的编辑字段。 */
function WorkspaceMainView({ workspace, controller, sidebar_collapsed }: { /** 当前 Workspace。 */ workspace: DesktopWorkspaceSummary; /** Desktop 根控制器。 */ controller: ReturnType<typeof use_desktop_controller>; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const [editor_field, set_editor_field] = useState<WorkspaceEditorField>("name");
  return <MainViewBayBarFrame view_key={`workspace:${workspace.workspace_id}`} sidebar_collapsed={sidebar_collapsed} title={editor_field === "name" ? "名称" : "Description"} baybar_content={<WorkspaceIdentityEditor key={`${workspace.workspace_id}:${editor_field}`} field={editor_field} workspace={workspace} update_workspace_name={controller.update_workspace_name} write_workspace_readme={controller.write_workspace_readme} />}>
    {(open_baybar) => <WorkspaceView workspace={workspace} open_editor={(field) => { set_editor_field(field); open_baybar(); }} />}
  </MainViewBayBarFrame>;
}

/** Agent MainView 独立拥有配置 BayBar 的状态与编辑分区。 */
function AgentMainView({ agent, controller, sidebar_collapsed, session_sidebar_collapsed, toggle_session_sidebar, main_session }: { /** 当前 Agent。 */ agent: DesktopAgentSummary; /** Desktop 根控制器。 */ controller: ReturnType<typeof use_desktop_controller>; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean; /** Session Sidebar 是否折叠。 */ session_sidebar_collapsed: boolean; /** 切换 Session Sidebar。 */ toggle_session_sidebar(): void; /** Agent 主对话。 */ main_session?: { workspace_id: string; session: DesktopSessionSummary } }) {
  const [section, set_section] = useState<AgentEditorSection>("model");
  const sidebar = <AgentChatSessionSidebar agent={agent} controller={controller} collapsed={session_sidebar_collapsed} />;
  return <MainViewBayBarFrame view_key={`agent:${agent.agent_id}`} sidebar_collapsed={sidebar_collapsed} title={section === "model" ? "Model" : section === "soul" ? "SOUL.md" : "Plugins"} baybar_content={<AgentInfoSidebar agent={agent} plugins={controller.plugins} controller={controller} section={section} embedded close_sidebar={() => undefined} />}>
    {(open_baybar) => <AgentView sidebar={sidebar} sidebar_collapsed={session_sidebar_collapsed} toggle_sidebar={toggle_session_sidebar} agent={agent} workspaces={controller.workspaces} plugins={controller.plugins} main_session={main_session} controller={controller} open_main_session={() => controller.open_agent_chat(agent.agent_id)} open_config={(next_section) => { set_section(next_section); open_baybar(); }} />}
  </MainViewBayBarFrame>;
}

/** Group MainView 独立拥有配置 BayBar 的状态与编辑分区。 */
function GroupMainView({ group, controller, sidebar_collapsed, session_sidebar_collapsed, toggle_session_sidebar }: { /** 当前 Group。 */ group: DesktopGroupSummary; /** Desktop 根控制器。 */ controller: ReturnType<typeof use_desktop_controller>; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean; /** Session Sidebar 是否折叠。 */ session_sidebar_collapsed: boolean; /** 切换 Session Sidebar。 */ toggle_session_sidebar(): void }) {
  const [section, set_section] = useState<GroupEditorSection>("model");
  const sidebar = <GroupChatSessionSidebar group={group} controller={controller} collapsed={session_sidebar_collapsed} />;
  return <MainViewBayBarFrame view_key={`group:${group.group_id}`} sidebar_collapsed={sidebar_collapsed} title={section === "model" ? "Model" : section === "instruction" ? "协作目标" : "成员"} baybar_content={<GroupInfoSidebar group={group} agents={controller.agents} controller={controller} section={section} embedded close_sidebar={() => undefined} />}>
    {(open_baybar) => <GroupConfigView sidebar={sidebar} sidebar_collapsed={session_sidebar_collapsed} toggle_sidebar={toggle_session_sidebar} group={group} agents={controller.agents} open_config={(next_section) => { set_section(next_section); open_baybar(); }} />}
  </MainViewBayBarFrame>;
}

/** Settings MainView 仅在 General 页面拥有自己的 Global Env BayBar。 */
function SettingsMainView({ controller, section, sidebar_collapsed }: { /** Desktop 根控制器。 */ controller: ReturnType<typeof use_desktop_controller>; /** 当前设置分区。 */ section: SettingsSection; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  if (section !== "general") return <SettingsView controller={controller} section={section} open_global_env={() => undefined} />;
  return <MainViewBayBarFrame view_key="settings:general" sidebar_collapsed={sidebar_collapsed} title="Global Env" baybar_content={<GlobalEnvEditor controller={controller} />}>
    {(open_baybar) => <SettingsView controller={controller} section={section} open_global_env={() => { void controller.list_global_env(); open_baybar(); }} />}
  </MainViewBayBarFrame>;
}

/** BayBar 中的 Global Env 原文编辑器。 */
function GlobalEnvEditor({ controller }: { controller: ReturnType<typeof use_desktop_controller> }) {
  const [draft, set_draft] = useState(controller.global_env);
  const [saving, set_saving] = useState(false);
  useEffect(() => set_draft(controller.global_env), [controller.global_env]);
  const save = async () => { set_saving(true); try { await controller.update_global_env(draft); } finally { set_saving(false); } };
  return <div className="flex h-full min-h-0 flex-col p-3"><textarea className="min-h-0 flex-1 resize-none bg-transparent font-mono text-xs leading-6 text-foreground outline-none" value={draft} onChange={(event) => set_draft(event.target.value)} spellCheck={false} aria-label="Global Env" /><div className="flex justify-end pt-3"><Button variant="primary" disabled={saving || draft === controller.global_env} onClick={() => void save()}>{saving ? "保存中" : "保存"}</Button></div></div>;
}
