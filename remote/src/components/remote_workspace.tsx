/** Connected Remote workspace: one header, shared chat, and responsive accessible navigation. */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChatPanel, Sheet, SheetContent, SheetTitle, SheetTrigger } from "@downcity/ui";
import { ArrowRight, LoaderCircle, Menu, MessageSquare, RotateCw } from "lucide-react";
import { translate_chinese_chat } from "../lib/chat_labels";
import { Remote_navigation } from "./remote_navigation";
import type { Remote_workspace_props } from "../types/components";
import { remote_activity_host } from "../lib/activity_host";

/** 只读取已授权 Agent 和主聊天 Session，不复制消息或执行状态。 */
export function Remote_workspace({ controller, locale, header_actions, showcase }: Remote_workspace_props) {
  const { state, select_agent, select_session, create_session } = controller;
  const activity_host = useMemo(() => remote_activity_host(locale), [locale]);
  const text = (en: string, zh: string) => locale === "zh" ? zh : en;
  const [navigation_open, set_navigation_open] = useState(false);
  const workspace_ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const shell = workspace_ref.current?.closest<HTMLElement>(".remote-app");
    const viewport = window.visualViewport;
    const update_height = () => shell?.style.setProperty("--remote-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
    const desktop = window.matchMedia("(min-width: 701px)");
    const close_on_desktop = () => { if (desktop.matches) set_navigation_open(false); };
    update_height();
    viewport?.addEventListener("resize", update_height);
    window.addEventListener("resize", update_height);
    desktop.addEventListener("change", close_on_desktop);
    return () => {
      viewport?.removeEventListener("resize", update_height);
      window.removeEventListener("resize", update_height);
      desktop.removeEventListener("change", close_on_desktop);
      shell?.style.removeProperty("--remote-viewport-height");
    };
  }, []);
  const current_connection = useRef(state.connection);
  current_connection.current = state.connection;
  const agent = state.agents.find(item => item.id === state.agent_id);
  const session = state.sessions.find(item => item.id === state.session_id);
  const [loading_earlier, set_loading_earlier] = useState(false);
  const [has_earlier, set_has_earlier] = useState(true);
  const [history_error, set_history_error] = useState<string>();
  useEffect(() => { set_has_earlier(true); set_loading_earlier(false); set_history_error(undefined); }, [state.connection]);

  const navigation = (mobile = false) => <Remote_navigation controller={controller} locale={locale} showcase={showcase} mobile={mobile} on_navigate={() => set_navigation_open(false)} />;
  const load_earlier = async () => {
    const connection = state.connection;
    if (!connection || loading_earlier) return;
    set_loading_earlier(true);
    set_history_error(undefined);
    try {
      const has_more = await connection.load_earlier();
      if (current_connection.current === connection) set_has_earlier(has_more);
    } catch (error) {
      if (current_connection.current === connection) set_history_error(String(error));
    } finally {
      if (current_connection.current === connection) set_loading_earlier(false);
    }
  };

  return <div ref={workspace_ref} className="remote-workspace">
    <aside className="remote-sidebar">{navigation()}</aside>
    <main className="remote-main" aria-busy={state.busy}>
      <header className="conversation-header">
        <Sheet open={navigation_open} onOpenChange={set_navigation_open}>
          <SheetTrigger className="icon-button mobile-menu" aria-label={text("Open navigation", "打开导航")}><Menu size={19} /></SheetTrigger>
          <SheetContent side="left" className="remote-mobile-navigation" showCloseButton={false}><SheetTitle className="sr-only">{text("Agents and conversations", "Agent 与会话")}</SheetTitle>{navigation(true)}</SheetContent>
        </Sheet>
        <h1 className="conversation-heading" title={state.session_title ?? session?.title}>{state.session_title || session?.title || text("New conversation", "新对话")}</h1>
        {showcase ? <span className="showcase-label">{text("Preview", "预览")}</span> : null}
        <div className="conversation-actions">{agent ? <button className="icon-button" disabled={state.busy} aria-label={text("Reconnect conversation", "重新连接会话")} title={text("Reconnect conversation", "重新连接会话")} onClick={() => { if (state.session_id) void select_session(state.session_id, state.session_type); else void select_agent(agent.id); }}><RotateCw size={16} /></button> : null}{header_actions}</div>
      </header>
      {state.error ? <div className="workspace-error" role="alert">{state.error}</div> : null}
      {state.storage_notice ? <div className="workspace-error" role="status">{state.storage_notice}</div> : null}
      {state.connection ? <>
        <ChatPanel activity_host={activity_host} status_panel={state.status_panel} key={`${state.agent_id}:${state.session_type ?? "chat"}:${state.session_id}`} className="remote-chat" translate={locale === "zh" ? translate_chinese_chat : undefined} runtime={state.connection.runtime} agent={agent ? { agent_id: agent.id, name: agent.name } : undefined} show_header={false} on_load_earlier={has_earlier ? load_earlier : undefined} earlier_loading={loading_earlier} earlier_label={text("Earlier messages", "更早的消息")} earlier_loading_label={text("Loading…", "正在加载…")} earlier_error={history_error} title={state.session_title ?? session?.title} empty_title={text("What’s on your mind?", "今天想聊点什么？")} empty_description={text("Pick up an idea. Make something happen.", "聊一个想法，或一起完成一件事。 ")} input_placeholder={text(`Message ${agent?.name || "your agent"}…`, `给 ${agent?.name || "Agent"} 发消息…`)} />
      </> : <div className="workspace-empty">{state.busy ? <><LoaderCircle size={26} className="spin" /><p role="status">{text("Getting things ready…", "正在准备对话…")}</p></> : <><MessageSquare size={28} strokeWidth={1.3} /><h1>{agent ? text("A little space to think.", "留一点空间，聊聊想法。") : text("Your City is connected.", "已连接你的 City。")}</h1><p>{agent ? agent.description || text("Start a conversation with your agent.", "和你的 Agent 开始一段新对话。") : text("No agents are available with this connection.", "当前连接下暂无可访问的 Agent。")}</p>{agent ? <button className="primary-button" onClick={() => void create_session()}>{text("Start a conversation", "开始对话")}<ArrowRight size={16} /></button> : null}</>}</div>}
    </main>
  </div>;
}
