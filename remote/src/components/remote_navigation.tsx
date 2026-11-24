/** Connected navigation: shared Agent menu, stable conversation rows, and connection actions. */
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@downcity/ui";
import { ChevronDown, LoaderCircle, LogOut, MessageSquare, Plus, X } from "lucide-react";
import type { Remote_workspace_props } from "../types/components";

/** The same navigation tree is used by the desktop sidebar and the accessible mobile sheet. */
export function Remote_navigation({ controller, locale, showcase, on_navigate, mobile = false }: Remote_workspace_props & {
  /** Close the mobile sheet after a navigation choice; desktop hosts supply a no-op. */
  on_navigate: () => void;
  /** Only the sheet instance displays its dismiss action. */
  mobile?: boolean;
}) {
  const { state } = controller;
  const agent = state.agents.find(item => item.id === state.agent_id);
  const text = (en: string, zh: string) => locale === "zh" ? zh : en;
  return <>
    <div className="sidebar-top">
      <a className="sidebar-brand" href="https://downcity.ai" aria-label="Downcity homepage"><img src="/icon.png" alt="" width="24" height="24" /><span>Remote</span></a>
      {mobile ? <button className="icon-button" onClick={on_navigate} aria-label={text("Close navigation", "关闭导航")}><X size={18} /></button> : null}
    </div>
    <DropdownMenu>
      <DropdownMenuTrigger className="agent-selector" disabled={state.busy || !state.agents.length} aria-label={text("Choose agent", "选择 Agent")}>
        <span className="agent-avatar" aria-hidden="true">{(agent?.name || "A").slice(0, 1)}</span>
        <span className="agent-selector-name">{agent?.name || text("No agents available", "暂无可访问的 Agent")}</span><ChevronDown size={15} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="remote-agent-menu" align="start" sideOffset={6}>
        <DropdownMenuRadioGroup value={state.agent_id || ""} onValueChange={value => { on_navigate(); void controller.select_agent(value); }}>
          {state.agents.map(item => <DropdownMenuRadioItem key={item.id} value={item.id}><span className="agent-menu-copy"><span>{item.name || item.id}</span>{item.description ? <small>{item.description}</small> : null}</span></DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    <button className="new-conversation" disabled={state.busy || !agent} onClick={() => { on_navigate(); void controller.create_session(); }}><Plus size={16} />{text("New conversation", "新对话")}</button>
    <div className="sidebar-section-label">{text("Conversations", "会话")}{state.busy ? <LoaderCircle size={12} className="spin" aria-label={text("Loading conversations", "正在加载会话")} /> : null}</div>
    <nav className="session-list" aria-label={text("Conversations", "会话列表")}>
      {!state.sessions.length && !state.busy ? <p className="sidebar-empty">{text("Your conversations will appear here.", "你的会话会显示在这里。")}</p> : null}
      {state.sessions.map(item => <button key={item.id} className={`session-item ${item.id === state.session_id ? "is-selected" : ""}`} aria-current={item.id === state.session_id ? "page" : undefined} title={item.title || text("Untitled conversation", "未命名会话")} disabled={state.busy} onClick={() => { on_navigate(); void controller.select_session(item.id); }}>
        <MessageSquare size={15} aria-hidden="true" /><span>{item.title || text("Untitled conversation", "未命名会话")}</span>{item.executing ? <i className="activity-dot" aria-label={text("Running", "运行中")} /> : null}
      </button>)}
      {state.next_cursor ? <button className="text-button more-sessions" disabled={state.loading_more || state.busy} onClick={() => void controller.load_more()}>{state.loading_more ? text("Loading…", "正在加载…") : text("Load more", "加载更多")}</button> : null}
    </nav>
    {mobile ? <a className="navigation-guide" href={`https://downcity.ai/${locale === "zh" ? "zh/" : ""}docs/remote`} target="_blank" rel="noreferrer">{text("Guide", "使用指南")}</a> : null}
    <div className="sidebar-bottom"><span title={showcase ? undefined : state.city_url}><i className="connection-dot" data-synthetic={showcase || undefined} />{showcase ? text("Synthetic preview", "模拟预览") : new URL(state.city_url).host}</span><button className="icon-button" title={showcase ? text("Reset preview", "重置预览") : text("Disconnect", "断开连接")} aria-label={showcase ? text("Reset preview", "重置预览") : text("Disconnect", "断开连接")} onClick={() => { on_navigate(); controller.disconnect(); }}><LogOut size={16} /></button></div>
    {state.saved_city_url ? <button className="text-button forget-connection" onClick={controller.forget_connection}>{text("Forget this connection", "忘记此连接")}</button> : null}
  </>;
}
