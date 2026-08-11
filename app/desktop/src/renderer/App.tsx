/** Downcity Desktop 根应用壳，直接沿用 Duobox 的 Sidebar + MainView 结构。 */

import { useState } from "react";
import { CreateAgentDialog } from "@/components/CreateAgentDialog";
import { Button } from "@/components/ui/button";
import { use_desktop_controller } from "@/hooks/use_desktop_controller";
import { NavigationSidebar } from "@/layouts/NavigationSidebar";
import { get_session_key } from "@/types/DesktopView";
import { AgentView } from "@/views/AgentView";
import { SessionView } from "@/views/SessionView";
import { WelcomeView } from "@/views/WelcomeView";

/** Desktop 根组件。 */
export function App() {
  const controller = use_desktop_controller();
  const [create_dialog_open, set_create_dialog_open] = useState(false);
  const selected_agent = controller.selection ? controller.agents.find((agent) => agent.agent_id === controller.selection?.agent_id) : undefined;

  const render_main_view = () => {
    if (!controller.selection || !selected_agent) return <WelcomeView />;
    if (controller.selection.kind === "agent") return <AgentView
      agent={selected_agent}
      runtime_state={controller.runtime_by_agent[selected_agent.agent_id] ?? "idle"}
      session_count={(controller.sessions_by_agent[selected_agent.agent_id] ?? []).length}
      connect_agent={() => controller.connect_agent(selected_agent.agent_id)}
      create_session={() => controller.create_session(selected_agent.agent_id)}
    />;
    const selected_session_id = controller.selection.session_id;
    const session = (controller.sessions_by_agent[selected_agent.agent_id] ?? []).find((item) => item.session_id === selected_session_id);
    if (!session) return <WelcomeView />;
    const session_key = get_session_key(selected_agent.agent_id, session.session_id);
    return <SessionView
      agent={selected_agent}
      session={session}
      messages={controller.messages_by_session[session_key] ?? []}
      sending={controller.sending_session_key === session_key}
      send_message={(text) => controller.send_message(selected_agent.agent_id, session.session_id, text)}
    />;
  };

  return <div className="fixed inset-0 flex overflow-hidden bg-muted">
    <div className="flex h-full w-full overflow-hidden">
      <NavigationSidebar controller={controller} open_create_agent={() => set_create_dialog_open(true)} />
      <main className="flex h-full min-w-0 flex-1 flex-col bg-background">{render_main_view()}</main>
    </div>
    {controller.error ? <div className="fixed bottom-5 left-1/2 z-40 flex max-w-xl -translate-x-1/2 items-start gap-3 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-xl"><span className="min-w-0 flex-1 break-words">{controller.error}</span><Button onClick={controller.clear_error}>关闭</Button></div> : null}
    {create_dialog_open ? <CreateAgentDialog close_dialog={() => set_create_dialog_open(false)} create_agent={controller.create_agent} /> : null}
  </div>;
}
