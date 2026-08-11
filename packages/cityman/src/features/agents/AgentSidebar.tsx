/** Duobox 风格的 Agent/Session 侧栏。 */

import type { CityWebAgent, CityWebSession } from "../../types/city-web";

interface AgentSidebarProps {
  /** 当前可见的全局 Agent。 */
  agents: CityWebAgent[];
  /** 当前选中的 Agent。 */
  active_agent_id: string;
  /** 当前 Agent 的 Session 列表。 */
  sessions: CityWebSession[];
  /** 当前选中的 Session。 */
  active_session_id: string;
  /** 选择 Agent。 */
  on_agent_select: (agent_id: string) => void;
  /** 选择 Session。 */
  on_session_select: (session_id: string) => void;
  /** 创建 Session。 */
  on_create_session: () => void;
  /** Agent 生命周期动作。 */
  on_agent_action: (action: "start" | "stop" | "restart") => void;
}

export function AgentSidebar(props: AgentSidebarProps) {
  const active_agent = props.agents.find((agent) => agent.agent_id === props.active_agent_id);
  return <aside className="city-sidebar">
    <div className="city-sidebar-brand"><span className="city-brand-mark">D</span><div><strong>Downcity</strong><small>AGENT WORKSPACE</small></div></div>
    <div className="city-sidebar-section"><div className="city-sidebar-label">AGENTS</div>{props.agents.map((agent) => <button className={`city-agent-item ${agent.agent_id === props.active_agent_id ? "is-active" : ""}`} key={agent.agent_id} onClick={() => props.on_agent_select(agent.agent_id)}><span className={`city-status-dot ${agent.status}`} /><span className="city-agent-item-body"><strong>{agent.agent_id}</strong><small>{agent.status}</small></span></button>)}</div>
    {active_agent ? <div className="city-sidebar-actions"><button onClick={() => props.on_agent_action(active_agent.status === "running" ? "stop" : "start")}>{active_agent.status === "running" ? "停止 Agent" : "启动 Agent"}</button><button onClick={() => props.on_agent_action("restart")}>重启 Agent</button></div> : null}
    <div className="city-sidebar-section city-session-section"><div className="city-sidebar-label"><span>SESSIONS</span><button onClick={props.on_create_session} title="新建会话">＋</button></div>{props.sessions.map((session) => <button className={`city-session-item ${session.session_id === props.active_session_id ? "is-active" : ""}`} key={session.session_id} onClick={() => props.on_session_select(session.session_id)}><span className="city-session-icon">◌</span><span><strong>{session.title || session.session_id}</strong><small>{session.preview_text || `${session.message_count} 条消息`}</small></span></button>)}</div>
  </aside>;
}

