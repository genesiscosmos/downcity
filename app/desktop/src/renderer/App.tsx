/** Downcity Desktop 根应用壳，直接沿用 Duobox 的 Sidebar + MainView 结构。 */

import { useState } from "react";
import { CreateAgentDialog } from "@/components/CreateAgentDialog";
import { CreateWorkspaceDialog } from "@/components/CreateWorkspaceDialog";
import { Button } from "@/components/ui/button";
import { use_desktop_controller } from "@/hooks/use_desktop_controller";
import { NavigationSidebar } from "@/layouts/NavigationSidebar";
import { SettingsSidebar } from "@/layouts/SettingsSidebar";
import { get_session_key } from "@/types/DesktopView";
import { AgentView } from "@/views/AgentView";
import { SessionView } from "@/views/SessionView";
import { SettingsView } from "@/views/SettingsView";
import { PluginView } from "@/views/PluginView";
import { WelcomeView } from "@/views/WelcomeView";
import { WorkspaceView } from "@/views/WorkspaceView";

/** Desktop 根组件。 */
export function App() {
  const controller = use_desktop_controller();
  const [create_dialog_open, set_create_dialog_open] = useState(false);
  const [create_workspace_dialog_open, set_create_workspace_dialog_open] = useState(false);
  const [create_agent_workspace_id, set_create_agent_workspace_id] = useState<string>();
  const current_selection = controller.selection;
  const selected_agent = current_selection?.kind === "agent" || current_selection?.kind === "session" || current_selection?.kind === "draft"
    ? controller.agents.find((agent) => agent.agent_id === current_selection.agent_id)
    : undefined;

  const render_main_view = () => {
    if (controller.selection?.kind === "settings") return <SettingsView controller={controller} section={controller.selection.section} />;
    if (controller.selection?.kind === "plugin") {
      const plugin_name = controller.selection.plugin_name;
      const plugin = controller.plugins.find((item) => item.plugin_name === plugin_name);
      return plugin ? <PluginView plugin={plugin} /> : <WelcomeView />;
    }
    if (controller.selection?.kind === "workspace") {
      const workspace_id = controller.selection.workspace_id;
      const workspace = controller.workspaces.find((item) => item.workspace_id === workspace_id);
      if (!workspace) return <WelcomeView />;
      const workspace_agents = controller.agents.filter((agent) => agent.workspace_id === workspace.workspace_id);
      return <WorkspaceView
        workspace={workspace}
        agents={workspace_agents}
        sessions_by_agent={controller.sessions_by_agent}
        open_create_agent={() => { set_create_agent_workspace_id(workspace.workspace_id); set_create_dialog_open(true); }}
        select_agent={controller.select_agent}
        select_session={controller.select_session}
      />;
    }
    if (!controller.selection || !selected_agent) return <WelcomeView />;
    if (controller.selection.kind === "agent") return <AgentView
      agent={selected_agent}
      workspaces={controller.workspaces}
      plugins={controller.plugins}
      sessions={controller.sessions_by_agent[selected_agent.agent_id] ?? []}
      create_session={() => controller.create_session(selected_agent.agent_id)}
      select_session={(session_id) => controller.select_session(selected_agent.agent_id, session_id)}
    />;
    if (controller.selection.kind === "draft") {
      const draft_id = controller.selection.draft_id;
      const draft_key = get_session_key(selected_agent.agent_id, draft_id);
      return <SessionView
        agent={selected_agent}
        session={{ session_id: draft_id, title: "新对话", preview_text: "", created_at: 0, updated_at: 0, message_count: 0, executing: false }}
        messages={[]}
        draft={controller.drafts_by_session[draft_key] ?? ""}
        draft_files={controller.draft_files_by_session[draft_key] ?? []}
        queued_messages={[]}
        settings={controller.settings}
        models={controller.models}
        configuration={controller.configuration_by_session[draft_key] ?? { model_id: selected_agent.model_id, approval_mode: "ask" }}
        models_loading={controller.models_loading}
        update_draft={(text) => controller.update_draft(selected_agent.agent_id, draft_id, text)}
        update_draft_files={(files) => controller.update_draft_files(selected_agent.agent_id, draft_id, files)}
        send_message={(input) => controller.send_message(selected_agent.agent_id, draft_id, input)}
        refresh_models={controller.refresh_models}
        set_model={(model_id) => controller.set_session_model(selected_agent.agent_id, draft_id, model_id)}
        set_approval_mode={(approval_mode) => controller.set_session_approval_mode(selected_agent.agent_id, draft_id, approval_mode)}
        stop_session={async () => undefined}
        respond_interaction={async () => undefined}
        remove_queued_message={() => undefined}
        move_queued_message={() => undefined}
        load_earlier_history={async () => undefined}
      />;
    }
    const selected_session_id = controller.selection.session_id;
    const session = (controller.sessions_by_agent[selected_agent.agent_id] ?? []).find((item) => item.session_id === selected_session_id);
    if (!session) return <WelcomeView />;
    const session_key = get_session_key(selected_agent.agent_id, session.session_id);
    return <SessionView
      agent={selected_agent}
      session={session}
      messages={controller.messages_by_session[session_key] ?? []}
      runtime={controller.chat_runtime_by_session[session_key]}
      draft={controller.drafts_by_session[session_key] ?? ""}
      draft_files={controller.draft_files_by_session[session_key] ?? []}
      queued_messages={controller.queued_messages_by_session[session_key] ?? []}
      history={controller.history_by_session[session_key]}
      settings={controller.settings}
      models={controller.models}
      configuration={controller.configuration_by_session[session_key]}
      models_loading={controller.models_loading}
      update_draft={(text) => controller.update_draft(selected_agent.agent_id, session.session_id, text)}
      update_draft_files={(files) => controller.update_draft_files(selected_agent.agent_id, session.session_id, files)}
      send_message={(input) => controller.send_message(selected_agent.agent_id, session.session_id, input)}
      refresh_models={controller.refresh_models}
      set_model={(model_id) => controller.set_session_model(selected_agent.agent_id, session.session_id, model_id)}
      set_approval_mode={(approval_mode) => controller.set_session_approval_mode(selected_agent.agent_id, session.session_id, approval_mode)}
      stop_session={() => controller.stop_session(selected_agent.agent_id, session.session_id)}
      respond_interaction={(input) => controller.respond_interaction(selected_agent.agent_id, session.session_id, input)}
      remove_queued_message={(message_id) => controller.remove_queued_message(selected_agent.agent_id, session.session_id, message_id)}
      move_queued_message={(message_id, direction) => controller.move_queued_message(selected_agent.agent_id, session.session_id, message_id, direction)}
      load_earlier_history={() => controller.load_earlier_history(selected_agent.agent_id, session.session_id)}
    />;
  };

  return <div className="fixed inset-0 flex overflow-hidden bg-muted">
    <div className="flex h-full w-full overflow-hidden">
      {controller.selection?.kind === "settings"
        ? <SettingsSidebar controller={controller} />
        : <NavigationSidebar
          controller={controller}
          open_create_agent={(workspace_id) => { set_create_agent_workspace_id(workspace_id); set_create_dialog_open(true); }}
          open_create_workspace={() => set_create_workspace_dialog_open(true)}
        />}
      <main className="flex h-full min-w-0 flex-1 flex-col bg-background">{render_main_view()}</main>
    </div>
    {controller.error ? <div className="fixed bottom-5 left-1/2 z-40 flex max-w-xl -translate-x-1/2 items-start gap-3 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-xl"><span className="min-w-0 flex-1 break-words">{controller.error}</span><Button onClick={controller.clear_error}>关闭</Button></div> : null}
    {create_dialog_open ? <CreateAgentDialog close_dialog={() => { set_create_dialog_open(false); set_create_agent_workspace_id(undefined); }} create_agent={controller.create_agent} models={controller.models} models_loading={controller.models_loading} default_model_id={controller.settings.default_text_model_id} workspace={controller.workspaces.find((workspace) => workspace.workspace_id === create_agent_workspace_id)} /> : null}
    {create_workspace_dialog_open ? <CreateWorkspaceDialog close_dialog={() => set_create_workspace_dialog_open(false)} create_workspace={controller.create_workspace} /> : null}
  </div>;
}
