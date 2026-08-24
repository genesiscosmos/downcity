/**
 * Agent 内部运行时协议。
 *
 * 这些函数只供 City、transport 与 Agent 自身使用。它们承载 Agent 与
 * Workspace 的运行时关系，但不把执行作用域提升为 Agent 的公开领域 API。
 */
import { Agent } from "@/agent/Agent.js";
import { AgentWorkspace } from "@/agent/AgentWorkspace.js";
import type { WorkspaceBase } from "@downcity/workspace";
import type { City } from "../city/index.js";
import type { WorkspaceStorageScope } from "@downcity/workspace";
import type { AgentStorage } from "@/types/agent/AgentStorage.js";
import { LocalSessionStore } from "@/workspace/store/LocalSessionStore.js";
import { MemoryFileSystem } from "@/workspace/store/MemoryFileSystem.js";
import {
  start_action_schedule_runtime,
  type ActionScheduleRuntimeHandle,
} from "@/plugin/core/ActionScheduleRuntime.js";

interface AgentRuntimeState {
  bound_city?: City;
  workspaces_by_id: Map<string, AgentWorkspace>;
  agent_storage?: AgentStorage;
  action_schedule?: ActionScheduleRuntimeHandle;
  action_schedule_promise?: Promise<void>;
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

/** 返回 Agent 所属 City 提供的私有存储作用域。 */
export function agent_storage_scope(agent: Agent): WorkspaceStorageScope | null {
  const city = runtime_state(agent).bound_city;
  return city ? city.open_agent_storage(agent.id) : null;
}

/** 获取或创建 Agent 在 City 中唯一的 Session 存储。 */
export function get_agent_storage(
  agent: Agent,
): AgentStorage {
  const state = runtime_state(agent);
  if (state.agent_storage) return state.agent_storage;
  const scope = state.bound_city?.open_agent_storage(agent.id);
  const files = scope?.files || MemoryFileSystem.shared(`/memory/agents/${agent.id}`);
  const storage: AgentStorage = {
    root_path: scope?.root_path || files.root_path,
    files,
    sessions: new LocalSessionStore({
      files,
      storage_root_path: scope?.root_path || files.root_path,
      agent_id: agent.id,
    }),
  };
  state.agent_storage = storage;
  return storage;
}

/** 启动 Agent 唯一的 ActionSchedule 轮询器；重复调用共享同一个启动 Promise。 */
export function ensure_agent_action_schedule(agent: Agent): void {
  const state = runtime_state(agent);
  if (state.action_schedule || state.action_schedule_promise) return;
  const storage = state.agent_storage;
  if (!storage) return;
  state.action_schedule_promise = (async () => {
    await agent.ensure_ready();
    const handle = await start_action_schedule_runtime(
      agent.id,
      storage,
      agent.get_logger(),
      (workspace_id) => {
        const state = runtime_state(agent);
        if (workspace_id) return state.workspaces_by_id.get(workspace_id)?.get_context() || null;
        return state.workspaces_by_id.values().next().value?.get_context() || null;
      },
    );
    state.action_schedule = handle;
  })().catch((error) => {
    agent.get_logger().error(`ActionSchedule start failed: ${String(error)}`);
  });
}

/** 停止 Agent 级后台资源并释放 Agent 级 Store。 */
export async function dispose_agent_runtime(agent: Agent): Promise<void> {
  const state = runtime_state(agent);
  await state.action_schedule_promise?.catch(() => undefined);
  state.action_schedule?.stop();
  state.action_schedule = undefined;
  state.action_schedule_promise = undefined;
  await state.agent_storage?.sessions.dispose();
  state.agent_storage = undefined;
}

/** 返回 Agent 已装配的唯一存储；未装配时返回 null。 */
export function agent_storage(agent: Agent): AgentStorage | null {
  return runtime_state(agent).agent_storage ?? null;
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
  ensure_agent_action_schedule(agent);
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
