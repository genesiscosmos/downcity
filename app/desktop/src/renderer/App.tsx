/** Downcity Desktop 的 Agent 与聊天主界面。 */
import { useEffect, useState } from "react";
import type { DesktopAgentSummary, DesktopSessionSummary } from "../common/types/DesktopApi";

/** Desktop 根组件。 */
export function App() {
  const [agents, set_agents] = useState<DesktopAgentSummary[]>([]);
  const [selected_agent_id, set_selected_agent_id] = useState("");
  const [session, set_session] = useState<DesktopSessionSummary | null>(null);
  const [input, set_input] = useState("");
  const [messages, set_messages] = useState<string[]>([]);
  const [error, set_error] = useState("");
  const [busy, set_busy] = useState(false);

  useEffect(() => {
    void window.downcity.agent.list().then(set_agents).catch((reason) => set_error(String(reason)));
  }, []);

  /** 创建共享 Agent 注册记录。 */
  const create_agent = async () => {
    const workspace_path = window.prompt("Workspace 绝对路径", "")?.trim();
    if (!workspace_path) return;
    const agent_id = window.prompt("Agent ID", "default")?.trim();
    if (!agent_id) return;
    const model_id = window.prompt("City AIService Model ID", "")?.trim();
    if (!model_id) return;
    try {
      const agent = await window.downcity.agent.create(agent_id, workspace_path, model_id);
      set_agents((current_agents) => [...current_agents, agent]);
    } catch (reason) {
      set_error(String(reason));
    }
  };

  /** 启动 Agent 并创建聊天 Session。 */
  const open_agent = async (agent_id: string) => {
    set_busy(true);
    set_error("");
    try {
      await window.downcity.agent.start(agent_id);
      const next_session = await window.downcity.chat.create_session(agent_id);
      set_selected_agent_id(agent_id);
      set_session(next_session);
      set_messages([]);
    } catch (reason) {
      set_error(String(reason));
    } finally {
      set_busy(false);
    }
  };

  /** 发送一条消息。 */
  const send_message = async () => {
    const text = input.trim();
    if (!text || !session || !selected_agent_id) return;
    set_input("");
    set_messages((current_messages) => [...current_messages, `你：${text}`]);
    set_busy(true);
    try {
      const result = await window.downcity.chat.send(selected_agent_id, session.session_id, text);
      set_messages((current_messages) => [...current_messages, `Agent：${result.text || result.error || "无输出"}`]);
    } catch (reason) {
      set_error(String(reason));
    } finally {
      set_busy(false);
    }
  };

  return <main style={{ fontFamily: "-apple-system, sans-serif", padding: 32, color: "#e8e8e8", background: "#151515", minHeight: "100vh" }}>
    <h1>Downcity</h1>
    <p>与 Downcity CLI 共享 Agent 注册和运行状态。</p>
    <button onClick={() => void create_agent()}>创建 Agent</button>
    {error && <p style={{ color: "#ff7b7b" }}>{error}</p>}
    <section style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 24, marginTop: 24 }}>
      <aside>{agents.map((agent) => <button key={agent.agent_id} disabled={busy} onClick={() => void open_agent(agent.agent_id)} style={{ display: "block", width: "100%", marginBottom: 12, padding: 12, textAlign: "left" }}><strong>{agent.agent_id}</strong><br/><small>{agent.workspace_path}</small></button>)}</aside>
      <article style={{ border: "1px solid #444", borderRadius: 8, padding: 16, minHeight: 480 }}>
        <h2>{selected_agent_id || "选择 Agent"}</h2>
        <div style={{ minHeight: 340, whiteSpace: "pre-wrap" }}>{messages.map((message, index) => <p key={`${index}-${message}`}>{message}</p>)}</div>
        <textarea value={input} disabled={!session || busy} onChange={(event) => set_input(event.target.value)} style={{ width: "100%", minHeight: 72 }}/>
        <button disabled={!session || busy || !input.trim()} onClick={() => void send_message()}>{busy ? "处理中…" : "发送"}</button>
      </article>
    </section>
  </main>;
}
