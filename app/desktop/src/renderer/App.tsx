/** Downcity Desktop 根应用壳，直接沿用 Duobox 的 Sidebar + MainView 结构。 */

import { useEffect, useState } from "react";
import { CreateAgentDialog } from "@/components/CreateAgentDialog";
import { CreateWorkspaceDialog } from "@/components/CreateWorkspaceDialog";
import { Button } from "@/components/ui/button";
import { use_desktop_controller } from "@/hooks/use_desktop_controller";
import { NavigationSidebar } from "@/layouts/NavigationSidebar";
import { SettingsSidebar } from "@/layouts/SettingsSidebar";
import { get_session_key } from "@/types/DesktopView";
import { SessionView } from "@/views/SessionView";
import { SettingsView } from "@/views/SettingsView";
import { PluginView } from "@/views/PluginView";
import { WelcomeView } from "@/views/WelcomeView";
import { WorkspaceView } from "@/views/WorkspaceView";
import { BayBar, type BayBarState } from "@/layouts/BayBar";
import { ShellPanelControls } from "@/layouts/ShellPanelControls";
import { GroupInfoSidebar, GroupView, type GroupEditorSection } from "@/views/GroupView";
import { AgentInfoSidebar, AgentView, type AgentEditorSection } from "@/views/AgentView";
import { RecentSessionsSidebar } from "@/components/RecentSessionsSidebar";

/** 当前右侧面板。面板由根应用统一拥有，保证同一时间只有一个面板可见。 */
type RightPanelState = BayBarState & { /** 当前选中的配置分区。 */ section?: AgentEditorSection | GroupEditorSection };

/** Desktop 根组件。 */
export function App() {
  const controller = use_desktop_controller();
  const [create_dialog_open, set_create_dialog_open] = useState(false);
  const [create_workspace_dialog_open, set_create_workspace_dialog_open] = useState(false);
  const [create_workspace_id, set_create_workspace_id] = useState<string>();
  const [sidebar_collapsed, set_sidebar_collapsed] = useState(false);
  const [command_palette_open, set_command_palette_open] = useState(false);
  const [agent_config_section, set_agent_config_section] = useState<AgentEditorSection>("model");
  const [agent_config_collapsed, set_agent_config_collapsed] = useState(false);
  const [group_config_section, set_group_config_section] = useState<GroupEditorSection>("model");
  const [group_config_collapsed, set_group_config_collapsed] = useState(false);
  const [right_panel, set_right_panel] = useState<RightPanelState>({ open: false, expanded: false, active_tab: "recent" });
  const open_agent_config = (section: AgentEditorSection) => { set_agent_config_section(section); set_agent_config_collapsed(false); set_right_panel((current) => ({ ...current, open: true, active_tab: "agent_config", section })); };
  const open_group_config = (section: GroupEditorSection) => { set_group_config_section(section); set_group_config_collapsed(false); set_right_panel((current) => ({ ...current, open: true, active_tab: "group_config", section })); };
  const open_group_config_from_sidebar = async (group_id: string) => {
    await controller.open_group(group_id);
    open_group_config("model");
  };
  const current_selection = controller.selection;
  const selected_agent = current_selection?.kind === "agent" || current_selection?.kind === "session" || current_selection?.kind === "draft"
    ? controller.agents.find((agent) => agent.agent_id === current_selection.agent_id)
    : undefined;

  useEffect(() => {
    set_right_panel((panel) => panel.active_tab === "agent_config" ? { ...panel, open: false } : panel);
    set_agent_config_collapsed(false);
    set_agent_config_section("model");
  }, [selected_agent?.agent_id]);

  useEffect(() => {
    set_right_panel((panel) => panel.active_tab === "group_config" ? { ...panel, open: false } : panel);
    set_group_config_collapsed(false);
    set_group_config_section("model");
  }, [current_selection?.kind === "group_session" ? current_selection.group_id : undefined]);

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

  const render_main_view = () => {
    if (controller.selection?.kind === "settings") return <SettingsView controller={controller} section={controller.selection.section} />;
    if (controller.selection?.kind === "plugin") {
      const plugin_id = controller.selection.plugin_id;
      const plugin = controller.plugins.find((item) => item.plugin_id === plugin_id);
      return plugin ? <PluginView plugin={plugin} controller={controller} /> : <WelcomeView />;
    }
    if (controller.selection?.kind === "workspace") {
      const workspace_id = controller.selection.workspace_id;
      const workspace = controller.workspaces.find((item) => item.workspace_id === workspace_id);
      if (!workspace) return <WelcomeView />;
      const workspace_agents = controller.agents;
      return <WorkspaceView
        workspace={workspace}
        agents={workspace_agents}
        sessions_by_agent={Object.fromEntries(controller.agents.map((agent) => [agent.agent_id, (controller.sessions_by_workspace[workspace_id] ?? []).filter((item) => item.agent_id === agent.agent_id).map((item) => item.session)]))}
        open_create_agent={() => { set_create_workspace_id(workspace.workspace_id); set_create_dialog_open(true); }}
        select_agent={controller.select_agent}
        select_session={(agent_id, session_id) => controller.select_session(workspace_id, agent_id, session_id)}
      />;
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
        open_config={open_group_config}
        toggle_config_sidebar={() => { if (right_panel.active_tab !== "group_config" || !right_panel.open) open_group_config(group_config_section); else set_group_config_collapsed((value) => !value); }}
        config_sidebar_open={right_panel.active_tab === "group_config" && right_panel.open}
        config_sidebar_collapsed={group_config_collapsed}
        send_message={(session_id, text) => controller.send_group_message(group_selection.group_id, session_id, text)}
        stop_session={(session_id) => controller.stop_group(group_selection.group_id, session_id)}
      />;
    }
    if (!controller.selection || !selected_agent) return <WelcomeView />;
    if (controller.selection.kind === "agent") {
      const main_context = controller.settings.agent_main_sessions[selected_agent.agent_id];
      const main_session = main_context
        ? (controller.sessions_by_workspace[main_context.workspace_id] ?? []).find((item) => item.agent_id === selected_agent.agent_id && item.session.session_id === main_context.session_id)
        : undefined;
      return <AgentView
        agent={selected_agent}
        workspaces={controller.workspaces}
        plugins={controller.plugins}
        main_session={main_session ? { workspace_id: main_context!.workspace_id, session: main_session.session } : undefined}
        controller={controller}
        open_main_session={async () => {
          if (!main_context) return controller.open_agent_chat(selected_agent.agent_id);
          await controller.select_session(main_context.workspace_id, selected_agent.agent_id, main_context.session_id);
        }}
        open_config={open_agent_config}
        toggle_config_sidebar={() => { if (right_panel.active_tab !== "agent_config" || !right_panel.open) open_agent_config(agent_config_section); else set_agent_config_collapsed((value) => !value); }}
        config_sidebar_open={right_panel.active_tab === "agent_config" && right_panel.open}
        config_sidebar_collapsed={agent_config_collapsed}
      />;
    }
    if (controller.selection.kind === "draft") {
      const draft_id = controller.selection.draft_id;
      const workspace_id = controller.selection.workspace_id;
      const draft_key = get_session_key(workspace_id, selected_agent.agent_id, draft_id);
      return <SessionView
        workspace_id={workspace_id}
        agent={selected_agent}
        workspace={controller.workspaces.find((workspace) => workspace.workspace_id === workspace_id) ?? { workspace_id, workspace_path: "", name: workspace_id }}
        workspaces={controller.workspaces}
        agents={controller.agents}
        session={{ session_id: draft_id, title: "新对话", preview_text: "", created_at: 0, updated_at: 0, message_count: 0, executing: false }}
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
      workspace={controller.workspaces.find((workspace) => workspace.workspace_id === workspace_id) ?? { workspace_id, workspace_path: "", name: workspace_id }}
      workspaces={controller.workspaces}
        agents={controller.agents}
        session={session}
        sessions={(controller.sessions_by_workspace[workspace_id] ?? []).filter((item) => item.agent_id === selected_agent.agent_id).map((item) => item.session)}
        select_session={(session_id) => void controller.select_session(workspace_id, selected_agent.agent_id, session_id)}
      toggle_agent_config={() => { if (right_panel.active_tab !== "agent_config" || !right_panel.open) open_agent_config(agent_config_section); else set_agent_config_collapsed((value) => !value); }}
      agent_config_open={right_panel.active_tab === "agent_config" && right_panel.open && !agent_config_collapsed}
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
          open_group_config={open_group_config_from_sidebar}
          collapsed={sidebar_collapsed}
        />}
      <main data-sidebar-collapsed={sidebar_collapsed ? "true" : "false"} className="main-view-shell flex h-full min-w-0 flex-1 flex-col bg-background">{render_main_view()}</main>
      <BayBar state={right_panel}>{right_panel.active_tab === "recent" ? <RecentSessionsSidebar controller={controller} close_sidebar={() => set_right_panel((current) => ({ ...current, open: false }))} /> : right_panel.active_tab === "agent_config" && selected_agent && (current_selection?.kind === "agent" || current_selection?.kind === "session") ? <AgentInfoSidebar agent={selected_agent} plugins={controller.plugins} controller={controller} section={agent_config_section} collapsed={agent_config_collapsed} close_sidebar={() => set_right_panel((current) => ({ ...current, open: false }))} /> : right_panel.active_tab === "group_config" && current_selection?.kind === "group_session" && controller.groups.find((item) => item.group_id === current_selection.group_id) ? <GroupInfoSidebar group={controller.groups.find((item) => item.group_id === current_selection.group_id)!} agents={controller.agents} controller={controller} section={group_config_section} collapsed={group_config_collapsed} close_sidebar={() => set_right_panel((current) => ({ ...current, open: false }))} /> : null}</BayBar>
    </div>
    <ShellPanelControls sidebar_collapsed={sidebar_collapsed} toggle_sidebar={() => set_sidebar_collapsed((value) => !value)} baybar_open={right_panel.open} toggle_baybar={() => set_right_panel((current) => ({ ...current, open: !current.open }))} />
    {controller.error ? <div className="fixed bottom-5 left-1/2 z-40 flex max-w-xl -translate-x-1/2 items-start gap-3 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-xl"><span className="min-w-0 flex-1 break-words">{controller.error}</span><Button onClick={controller.clear_error}>关闭</Button></div> : null}
    {create_dialog_open ? <CreateAgentDialog close_dialog={() => { set_create_dialog_open(false); set_create_workspace_id(undefined); }} create_agent={controller.create_agent} models={controller.models} models_loading={controller.models_loading} default_model_id={controller.settings.default_text_model_id} workspace={controller.workspaces.find((workspace) => workspace.workspace_id === create_workspace_id)} /> : null}
    {create_workspace_dialog_open ? <CreateWorkspaceDialog close_dialog={() => set_create_workspace_dialog_open(false)} create_workspace={controller.create_workspace} /> : null}
    {command_palette_open ? <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[18vh]" onMouseDown={() => set_command_palette_open(false)}><div className="w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover p-2 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { set_command_palette_open(false); controller.open_settings("user"); }}>打开设置 <span className="ml-auto text-xs text-muted-foreground">⌘,</span></button><button type="button" className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { set_command_palette_open(false); set_sidebar_collapsed((value) => !value); }}>切换左侧边栏 <span className="ml-auto text-xs text-muted-foreground">⌘B</span></button></div></div> : null}
  </div>;
}
