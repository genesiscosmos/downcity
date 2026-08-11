/** City Web 应用根：全局 Agent 侧栏与 Duobox 风格对话面板。 */

import { useEffect, useState } from "react";
import { ThemeContainer } from "@downcity/ui";
import { AgentSidebar } from "./features/agents/AgentSidebar";
import { CityChatView } from "./features/chat/CityChatView";
import { request_city_web, list_city_agents, list_city_sessions } from "./lib/city-web-api";
import type { CityWebAgent, CityWebSession } from "./types/city-web";

export function App() {
  const [agents, set_agents] = useState<CityWebAgent[]>([]);
  const [sessions, set_sessions] = useState<CityWebSession[]>([]);
  const [agent_id, set_agent_id] = useState("");
  const [session_id, set_session_id] = useState("city-chat-main");
  const [error, set_error] = useState<string | null>(null);
  const refresh_agents = async () => { const next_agents = await list_city_agents(); set_agents(next_agents); if (!agent_id && next_agents[0]) set_agent_id(next_agents[0].agent_id); };
  useEffect(() => { void refresh_agents().catch((reason: unknown) => set_error(String(reason))); }, []);
  useEffect(() => { if (!agent_id) return; void list_city_sessions(agent_id).then(set_sessions).catch((reason: unknown) => set_error(String(reason))); }, [agent_id]);
  const select_agent = (next_agent_id: string) => { set_agent_id(next_agent_id); set_session_id("city-chat-main"); };
  const run_agent_action = async (action: "start" | "stop" | "restart") => { if (!agent_id) return; try { await request_city_web(`/api/agents/${encodeURIComponent(agent_id)}/${action}`, { method: "POST", body: "{}" }); await refresh_agents(); } catch (reason) { set_error(String(reason)); } };
  const create_session = async () => { if (!agent_id) return; try { const result = await request_city_web<{ session_id: string }>(`/api/agents/${encodeURIComponent(agent_id)}/sessions`, { method: "POST", body: "{}" }); set_session_id(result.session_id); set_sessions(await list_city_sessions(agent_id)); } catch (reason) { set_error(String(reason)); } };
  return <ThemeContainer mode="light" variant="neutral" className="city-theme"><div className="city-app-shell"><AgentSidebar agents={agents} active_agent_id={agent_id} sessions={sessions} active_session_id={session_id} on_agent_select={select_agent} on_session_select={set_session_id} on_create_session={() => void create_session()} on_agent_action={(action) => void run_agent_action(action)} />{agent_id ? <CityChatView agent_id={agent_id} session_id={session_id} sessions={sessions} on_session_select={set_session_id} on_session_created={(next_session_id) => { set_session_id(next_session_id); void list_city_sessions(agent_id).then(set_sessions); }} /> : <main className="city-empty-state"><h1>选择一个 Agent</h1><p>{error || "没有找到全局 Agent。请先使用 city agent create 创建 Agent。"}</p></main>}</div></ThemeContainer>;
}

