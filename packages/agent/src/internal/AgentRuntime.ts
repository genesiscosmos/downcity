/**
 * Agent 内部运行时协议。
 *
 * 这些函数只供 City、transport 与 Agent 自身使用。它们承载 Agent 与
 * Workspace 的运行时关系，但不把执行作用域提升为 Agent 的公开领域 API。
 */
import type { WorkspaceBase } from "@downcity/workspace";
import { Agent } from "@/agent/Agent.js";
import { AgentWorkspace } from "@/agent/AgentWorkspace.js";
import type { City } from "../city/index.js";

interface AgentRuntimeState {
  bound_city?: City;
  workspaces_by_id: Map<string, AgentWorkspace>;
}

const runtime_states = new WeakMap<Agent, AgentRuntimeState>();
/** 未加入 City 的 Workspace 只允许一个 Agent 建立执行作用域。 */
const unbound_workspace_owners = new WeakMap<object, Agent>();

export function initialize_agent_runtime(agent: Agent): void {
  runtime_states.set(agent, { workspaces_by_id: new Map() });
}

function runtime_state(agent: Agent): AgentRuntimeState {
  const state = runtime_states.get(agent);
  if (!state) throw new Error(`Agent "${agent.id}" runtime is not initialized`);
  return state;
}

export function attach_agent_city(agent: Agent, city: City): void {
  const state = runtime_state(agent);
  if (state.bound_city && state.bound_city !== city) {
    throw new Error(`Agent "${agent.id}" already belongs to another City`);
  }
  state.bound_city = city;
}

export function detach_agent_city(agent: Agent, city: City): void {
  const state = runtime_state(agent);
  if (state.bound_city === city) state.bound_city = undefined;
}

export function agent_city(agent: Agent): City | undefined {
  return runtime_state(agent).bound_city;
}

export function agent_is_in_city(agent: Agent): boolean {
  return Boolean(runtime_state(agent).bound_city);
}

export function create_agent_workspace(agent: Agent, workspace: WorkspaceBase): AgentWorkspace {
  const state = runtime_state(agent);
  const workspace_id = String(workspace?.id || "").trim();
  if (!workspace_id) throw new Error("Agent sessions require a Workspace with a stable id");
  const city = state.bound_city;
  if (city && city.get_workspace(workspace_id) !== workspace) {
    throw new Error(`Workspace "${workspace_id}" does not belong to the Agent City`);
  }
  if (!city) {
    const owner = unbound_workspace_owners.get(workspace);
    if (owner && owner !== agent) {
      throw new Error(`Workspace "${workspace_id}" already bound to another scope`);
    }
    unbound_workspace_owners.set(workspace, agent);
  }
  const existing = state.workspaces_by_id.get(workspace_id);
  if (existing) {
    if (existing.workspace !== workspace) {
      throw new Error(`Agent already entered Workspace "${workspace_id}" with another instance`);
    }
    return existing;
  }
  const entry = new AgentWorkspace({ agent, workspace });
  state.workspaces_by_id.set(workspace_id, entry);
  return entry;
}

export function get_agent_workspace(agent: Agent, workspace_id_input: string): AgentWorkspace | null {
  return runtime_state(agent).workspaces_by_id.get(String(workspace_id_input || "").trim()) ?? null;
}

export function list_agent_workspaces(agent: Agent): readonly AgentWorkspace[] {
  return [...runtime_state(agent).workspaces_by_id.values()];
}

export function release_agent_workspace(agent: Agent, workspace_id: string, entry: AgentWorkspace): void {
  const state = runtime_state(agent);
  if (state.workspaces_by_id.get(workspace_id) === entry) {
    state.workspaces_by_id.delete(workspace_id);
    if (!state.bound_city && unbound_workspace_owners.get(entry.workspace) === agent) {
      unbound_workspace_owners.delete(entry.workspace);
    }
  }
}

export function clear_agent_runtime(agent: Agent): void {
  runtime_states.delete(agent);
}
