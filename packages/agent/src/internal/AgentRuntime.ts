/**
 * Agent 内部运行时协议。
 *
 * 这些函数只供 City、transport 与 Agent 自身使用。它们承载 Agent 与
 * Workspace 的运行时关系，但不把执行作用域提升为 Agent 的公开领域 API。
 */
import { Agent } from "@/agent/Agent.js";
import { WorkspaceEntry } from "@/agent/WorkspaceEntry.js";
import type { WorkspaceRuntime } from "@downcity/type";
import type { StorageProvider, StorageScope } from "@downcity/type";
import { AgentMemoryStorageProvider } from "@/internal/AgentMemoryStorage.js";
import type { AgentStorage } from "@/types/agent/AgentStorage.js";
import type { SessionHooks } from "@/session/SessionHooks.js";
import { EMPTY_SESSION_HOOKS } from "@/session/SessionHooks.js";
import { LocalSessionStore } from "@/session/storage/LocalSessionStore.js";
import type { AgentRuntimeBinding } from "@/types/agent/AgentRuntimeBinding.js";

interface AgentRuntimeState {
  binding?: AgentRuntimeBinding;
  memory_session_started?: boolean;
  workspaces_by_id: Map<string, WorkspaceEntry>;
  storage_provider: StorageProvider;
  agent_storage?: AgentStorage;
}

const runtime_states = new WeakMap<Agent, AgentRuntimeState>();
/** 未加入 City 的 Workspace 只允许一个 Agent 建立执行作用域。 */
const unbound_workspace_owners = new WeakMap<object, Agent>();

export function initialize_agent_runtime(agent: Agent): void {
  runtime_states.set(agent, {
    workspaces_by_id: new Map(),
    storage_provider: new AgentMemoryStorageProvider(),
  });
}

function runtime_state(agent: Agent): AgentRuntimeState {
  const state = runtime_states.get(agent);
  if (!state) throw new Error(`Agent "${agent.id}" runtime is not initialized`);
  return state;
}

/** 把资源容器提供的运行能力一次性绑定到 Agent。 */
export function bind_agent_runtime(agent: Agent, binding: AgentRuntimeBinding): void {
  const state = runtime_state(agent);
  if (state.memory_session_started) {
    throw new Error(
      `Agent "${agent.id}" already created Session data without City; join City before creating Sessions`,
    );
  }
  if (state.binding && state.binding.owner !== binding.owner) {
    throw new Error(`Agent "${agent.id}" already belongs to another resource container`);
  }
  if (state.agent_storage) {
    throw new Error(`Agent "${agent.id}" storage is already initialized`);
  }
  state.binding = binding;
  state.storage_provider = binding.storage;
}

/** 返回当前 Agent 的资源绑定；未加入 City 时为空。 */
export function agent_runtime_binding(agent: Agent): AgentRuntimeBinding | undefined {
  return runtime_state(agent).binding;
}

/** 等待 City 为 Agent 提供的资源完成初始化。 */
export async function ensure_agent_runtime_ready(agent: Agent): Promise<void> {
  await runtime_state(agent).binding?.ensure_ready();
}

/** 返回当前 Agent/Workspace 的 Session Hooks；独立 Agent 使用空实现。 */
export function resolve_agent_session_hooks(
  agent: Agent,
  workspace?: WorkspaceRuntime,
): SessionHooks {
  const binding = runtime_state(agent).binding;
  if (!binding || !workspace) return EMPTY_SESSION_HOOKS;
  return binding.hooks(workspace, agent.get_logger());
}

/** 标记 Agent 已经创建或恢复过无 City 的 Session。 */
export function mark_agent_session_started(agent: Agent): void {
  const state = runtime_state(agent);
  if (!state.binding) state.memory_session_started = true;
}

/** 解除指定资源容器与 Agent 的绑定。 */
export function unbind_agent_runtime(agent: Agent, owner: object): void {
  const state = runtime_state(agent);
  if (state.binding?.owner === owner) {
    state.binding = undefined;
  }
}

export function agent_has_resource_container(agent: Agent): boolean {
  return Boolean(runtime_state(agent).binding);
}

/** 由 Agent 释放自身时通知所属资源容器。 */
export async function release_agent_from_container(agent: Agent): Promise<void> {
  await runtime_state(agent).binding?.release_agent(agent);
}

/** 返回 Agent 解释出的业务存储作用域。 */
export function agent_storage_scope(agent: Agent): StorageScope {
  return runtime_state(agent).storage_provider.open_scope(["agents", agent.id]);
}

/** 返回指定 Agent Plugin 的私有数据作用域。 */
export function plugin_storage_scope(agent: Agent, plugin_id: string): StorageScope {
  return runtime_state(agent).storage_provider.open_scope([
    "agents",
    agent.id,
    "plugins",
    plugin_id,
  ]);
}

/** 获取或创建 Agent 唯一的 Session 存储。 */
export function get_agent_storage(
  agent: Agent,
): AgentStorage {
  const state = runtime_state(agent);
  if (state.agent_storage) return state.agent_storage;
  const scope = state.storage_provider.open_scope(["agents", agent.id]);
  const files = scope.files;
  const storage: AgentStorage = {
    root_path: scope.root_path,
    files,
    sessions: new LocalSessionStore({
      files,
      storage_root_path: scope.root_path,
      agent_id: agent.id,
    }),
  };
  state.agent_storage = storage;
  return storage;
}

/** 停止 Agent 级后台资源并释放 Agent 级 Store。 */
export async function dispose_agent_runtime(agent: Agent): Promise<void> {
  const state = runtime_state(agent);
  await state.agent_storage?.sessions.dispose();
  state.agent_storage = undefined;
}

/** 返回 Agent 已装配的唯一存储；未装配时返回 null。 */
export function agent_storage(agent: Agent): AgentStorage | null {
  return runtime_state(agent).agent_storage ?? null;
}

export function create_workspace_entry(agent: Agent, workspace: WorkspaceRuntime): WorkspaceEntry {
  const state = runtime_state(agent);
  const workspace_id = String(workspace?.id || "").trim();
  if (!workspace_id) throw new Error("Agent sessions require a Workspace with a stable id");
  const binding = state.binding;
  if (binding && binding.get_workspace(workspace_id) !== workspace) {
    throw new Error(`Workspace "${workspace_id}" does not belong to the Agent resource container`);
  }
  if (!binding) {
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
  const entry = new WorkspaceEntry({ agent, workspace });
  state.workspaces_by_id.set(workspace_id, entry);
  return entry;
}

export function get_workspace_entry(agent: Agent, workspace_id_input: string): WorkspaceEntry | null {
  return runtime_state(agent).workspaces_by_id.get(String(workspace_id_input || "").trim()) ?? null;
}

export function list_workspace_entries(agent: Agent): readonly WorkspaceEntry[] {
  return [...runtime_state(agent).workspaces_by_id.values()];
}

export function release_workspace_entry(agent: Agent, workspace_id: string, entry: WorkspaceEntry): void {
  const state = runtime_state(agent);
  if (state.workspaces_by_id.get(workspace_id) === entry) {
    state.workspaces_by_id.delete(workspace_id);
    if (!state.binding && unbound_workspace_owners.get(entry.workspace) === agent) {
      unbound_workspace_owners.delete(entry.workspace);
    }
  }
}

export function clear_agent_runtime(agent: Agent): void {
  runtime_states.delete(agent);
}
