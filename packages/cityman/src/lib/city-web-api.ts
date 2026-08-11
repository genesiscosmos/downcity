/** City Web API 客户端；Renderer 不直接接触 Electron、Node 或 Agent SDK。 */

import type { CityWebAgent, CityWebSession } from "../types/city-web";

export async function request_city_web<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || `City Web request failed: ${response.status}`);
  }
  return await response.json() as T;
}

export async function list_city_agents(): Promise<CityWebAgent[]> {
  return (await request_city_web<{ agents: CityWebAgent[] }>("/api/agents")).agents;
}

export async function list_city_sessions(agent_id: string): Promise<CityWebSession[]> {
  return (await request_city_web<{ sessions: CityWebSession[] }>(`/api/agents/${encodeURIComponent(agent_id)}/sessions`)).sessions;
}

export async function read_city_session_messages(agent_id: string, session_id: string): Promise<Record<string, unknown>[]> {
  const result = await request_city_web<{ items?: Record<string, unknown>[] }>(`/api/agents/${encodeURIComponent(agent_id)}/sessions/${encodeURIComponent(session_id)}/messages`);
  return result.items ?? [];
}

export async function create_city_session(agent_id: string): Promise<string> {
  return (await request_city_web<{ session_id: string }>(`/api/agents/${encodeURIComponent(agent_id)}/sessions`, { method: "POST", body: "{}" })).session_id;
}

export async function execute_city_session(agent_id: string, session_id: string, instructions: string): Promise<void> {
  await request_city_web(`/api/agents/${encodeURIComponent(agent_id)}/sessions/${encodeURIComponent(session_id)}/execute`, { method: "POST", body: JSON.stringify({ instructions }) });
}

export async function stop_city_session(agent_id: string, session_id: string): Promise<void> {
  await request_city_web(`/api/agents/${encodeURIComponent(agent_id)}/sessions/${encodeURIComponent(session_id)}/stop`, { method: "POST", body: "{}" });
}

/** 将审批或问题回答写回当前 Session。 */
export async function respond_city_session_interaction(agent_id: string, session_id: string, interaction_id: string, response: unknown): Promise<void> {
  await request_city_web(`/api/agents/${encodeURIComponent(agent_id)}/sessions/${encodeURIComponent(session_id)}/respond`, { method: "POST", body: JSON.stringify({ interaction_id, response }) });
}

export function subscribe_city_session(agent_id: string, session_id: string, on_mutation: (mutation: Record<string, unknown>) => void, on_error: () => void): () => void {
  const source = new EventSource(`/api/agents/${encodeURIComponent(agent_id)}/sessions/${encodeURIComponent(session_id)}/events`);
  source.onmessage = (event) => { try { on_mutation(JSON.parse(event.data) as Record<string, unknown>); } catch { on_error(); } };
  source.onerror = on_error;
  return () => source.close();
}
