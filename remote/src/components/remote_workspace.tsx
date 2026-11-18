/** 已连接界面：侧栏拥有导航，消息与输入直接复用 UI SDK，移动端使用原生模态抽屉。 */
import { useEffect, useRef, useState } from "react";
import { ChatPanel } from "@downcity/ui";
import { ArrowRight, ChevronDown, LoaderCircle, LogOut, Menu, MessageSquare, Plus, RotateCw, X } from "lucide-react";
import type { Remote_workspace_props } from "../types/components";
import { Private_interaction } from "./private_interaction";

/** 只读取已授权 Agent 和主聊天 Session，不复制消息或执行状态。 */
export function Remote_workspace({ controller, locale }: Remote_workspace_props) {
  const { state, select_agent, select_session, create_session, load_more, disconnect } = controller;
  const text = (en: string, zh: string) => locale === "zh" ? zh : en;
  const dialog_ref = useRef<HTMLDialogElement>(null);
  const agent = state.agents.find(item => item.id === state.agent_id);
  const session = state.sessions.find(item => item.session_id === state.session_id);
  const [loading_earlier, set_loading_earlier] = useState(false);
  const [has_earlier, set_has_earlier] = useState(true);
  const [history_error, set_history_error] = useState<string>();
  useEffect(() => { set_has_earlier(true); set_loading_earlier(false); set_history_error(undefined); }, [state.connection]);

  const navigation = <>
    <div className="sidebar-top"><span className="sidebar-label">{text("YOUR CITY", "你的 CITY")}</span><button className="icon-button drawer-close" onClick={() => dialog_ref.current?.close()} aria-label={text("Close navigation", "关闭导航")}><X size={18} /></button></div>
    <div className="agent-select-wrap"><select aria-label={text("Agent", "选择 Agent")} value={state.agent_id ?? ""} disabled={state.busy || !state.agents.length} onChange={event => void select_agent(event.target.value)}>{!state.agents.length ? <option value="">{text("No agents available", "暂无可访问的 Agent")}</option> : state.agents.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select><ChevronDown size={16} aria-hidden="true" /></div>
    <button className="new-conversation" disabled={state.busy || !agent} onClick={() => { dialog_ref.current?.close(); void create_session(); }}><Plus size={17} />{text("New conversation", "新对话")}</button>
    <div className="sidebar-section-label">{text("Conversations", "会话")}</div>
    <nav className="session-list" aria-label={text("Conversations", "会话列表")}>
      {!state.sessions.length && !state.busy ? <p className="sidebar-empty">{text("A fresh start.", "从一段新对话开始。")}</p> : null}
      {state.sessions.map(item => <button key={item.session_id} className={`session-item ${item.session_id === state.session_id ? "is-selected" : ""}`} aria-current={item.session_id === state.session_id ? "page" : undefined} disabled={state.busy} onClick={() => { dialog_ref.current?.close(); void select_session(item.session_id); }}><MessageSquare size={15} /><span>{item.title || text("Untitled conversation", "未命名会话")}</span>{item.executing ? <i className="activity-dot" aria-label={text("Running", "运行中")} /> : null}</button>)}
      {state.next_cursor ? <button className="text-button more-sessions" disabled={state.loading_more || state.busy} onClick={() => void load_more()}>{state.loading_more ? text("Loading…", "正在加载…") : text("Load more", "加载更多")}</button> : null}
    </nav>
    <div className="sidebar-bottom"><span title={state.city_url}><i className="connection-dot" />{new URL(state.city_url).host}</span><button className="icon-button" title={text("Disconnect", "断开连接")} aria-label={text("Disconnect", "断开连接")} onClick={disconnect}><LogOut size={17} /></button></div>
  </>;

  return <div className="remote-workspace">
    <aside className="remote-sidebar">{navigation}</aside>
    <dialog ref={dialog_ref} className="mobile-navigation" aria-label={text("Agents and conversations", "Agent 与会话")} onClick={event => { if (event.target === event.currentTarget) dialog_ref.current?.close(); }}><div className="mobile-navigation-inner">{navigation}</div></dialog>
    <main className="remote-main" aria-busy={state.busy}>
      <header className="conversation-header"><button className="icon-button mobile-menu" aria-label={text("Open navigation", "打开导航")} onClick={() => dialog_ref.current?.showModal()}><Menu size={19} /></button><div className="conversation-heading"><span>{agent?.name || text("Your City", "你的 City")}</span><small>{session?.title || (state.session_id ? text("Conversation", "对话") : text("New conversation", "新对话"))}</small></div>{agent ? <button className="icon-button" disabled={state.busy} aria-label={text("Reconnect conversation", "重新连接会话")} title={text("Reconnect conversation", "重新连接会话")} onClick={() => { if (state.session_id) void select_session(state.session_id); else void select_agent(agent.id); }}><RotateCw size={17} /></button> : null}</header>
      {state.error ? <div className="workspace-error" role="alert">{state.error}</div> : null}
      {state.connection ? <>
        <div className="history-actions">{has_earlier ? <button className="text-button" disabled={loading_earlier} onClick={() => {
          const connection = state.connection;
          if (!connection) return;
          set_loading_earlier(true);
          set_history_error(undefined);
          void connection.load_earlier().then(set_has_earlier).catch(error => set_history_error(String(error))).finally(() => set_loading_earlier(false));
        }}>{loading_earlier ? text("Loading…", "正在加载…") : text("Earlier messages", "更早的消息")}</button> : null}{history_error ? <p className="form-error" role="alert">{history_error}</p> : null}</div>
        <ChatPanel key={state.session_id} className="remote-chat" runtime={state.connection.runtime} title={session?.title} render_interaction={({ part, on_respond_interaction }) => part.type === "interaction" && part.questions?.some(question => question.response_type === "secret") ? <Private_interaction key={`${state.session_id}:${part.interaction_id}`} session_id={state.session_id!} part={part} read_interaction={controller.read_interaction} respond={on_respond_interaction} locale={locale} /> : undefined} empty_title={text("What’s on your mind?", "今天想聊点什么？")} empty_description={text("Pick up an idea. Make something happen.", "聊一个想法，或一起完成一件事。 ")} input_placeholder={text(`Message ${agent?.name || "your agent"}…`, `给 ${agent?.name || "Agent"} 发消息…`)} />
      </> : <div className="workspace-empty">{state.busy ? <><LoaderCircle size={26} className="spin" /><p role="status">{text("Getting things ready…", "正在准备对话…")}</p></> : <><MessageSquare size={28} strokeWidth={1.3} /><h1>{agent ? text("A little space to think.", "留一点空间，聊聊想法。") : text("Your City is connected.", "已连接你的 City。")}</h1><p>{agent ? agent.description || text("Start a conversation with your agent.", "和你的 Agent 开始一段新对话。") : text("No agents are available with this connection.", "当前连接下暂无可访问的 Agent。")}</p>{agent ? <button className="primary-button" onClick={() => void create_session()}>{text("Start a conversation", "开始对话")}<ArrowRight size={16} /></button> : null}</>}</div>}
    </main>
  </div>;
}
