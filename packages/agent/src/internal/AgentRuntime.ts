/**
 * Agent 内部运行时协议。
 *
 * 这些函数只供 City、transport 与 Agent 自身使用。它们承载 Agent 与
 * Workspace 的运行时关系，但不把执行作用域提升为 Agent 的公开领域 API。
 */
import { Agent } from "@/agent/Agent.js";
import { WorkspaceEntry } from "@/agent/WorkspaceEntry.js";
import type { WorkspaceBase } from "@downcity/workspace";
import type { Embassy } from "@downcity/federation";
import type { StorageProvider, StorageScope } from "@downcity/workspace";
import { MemoryStorageProvider } from "@downcity/workspace";
import type { AgentStorage } from "@/types/agent/AgentStorage.js";
import type { SessionExtensionRuntime } from "@/types/session/SessionExtension.js";
import { create_empty_session_extensions } from "@/types/session/SessionExtension.js";
import { LocalSessionStore } from "@/workspace/store/LocalSessionStore.js";
import type { AgentHost, AgentHostExtensions } from "@/types/agent/AgentHost.js";

interface AgentRuntimeState {
  host?: AgentHost;
  embassy?: Embassy;
  memory_session_started?: boolean;
  workspaces_by_id: Map<string, WorkspaceEntry>;
  storage_provider: StorageProvider;
  agent_storage?: AgentStorage;
  session_extensions?: (
    workspace?: WorkspaceBase,
  ) => SessionExtensionRuntime;
  host_extensions?: AgentHostExtensions;
}

const runtime_states = new WeakMap<Agent, AgentRuntimeState>();
/** 未加入 City 的 Workspace 只允许一个 Agent 建立执行作用域。 */
const unbound_workspace_owners = new WeakMap<object, Agent>();

export function initialize_agent_runtime(agent: Agent): void {
  runtime_states.set(agent, {
    workspaces_by_id: new Map(),
    storage_provider: new MemoryStorageProvider(),
  });
}

function runtime_state(agent: Agent): AgentRuntimeState {
  const state = runtime_states.get(agent);
  if (!state) throw new Error(`Agent "${agent.id}" runtime is not initialized`);
  return state;
}

export function attach_agent_host(agent: Agent, host: AgentHost): void {
  const state = runtime_state(agent);
  if (state.memory_session_started) {
    throw new Error(
      `Agent "${agent.id}" already created Session data without City; join City before creating Sessions`,
    );
  }
  if (state.host && state.host !== host) {
    throw new Error(`Agent "${agent.id}" already belongs to another host`);
  }
  state.host = host;
  state.embassy = host.embassy;
}

/** 将 City 提供的底层 Storage 注入 Agent；该函数只在组合根调用。 */
export function attach_agent_storage(agent: Agent, storage_provider: StorageProvider): void {
  const state = runtime_state(agent);
  if (state.memory_session_started) {
    throw new Error(
      `Agent "${agent.id}" already created Session data without City; join City before creating Sessions`,
    );
  }
  if (state.agent_storage) {
    throw new Error(`Agent "${agent.id}" storage is already initialized`);
  }
  state.storage_provider = storage_provider;
}

/** 由 City 注入按 Workspace 创建 Session 扩展运行时的端口。 */
export function attach_agent_session_extensions(
  agent: Agent,
  resolve_extensions: (workspace?: WorkspaceBase) => SessionExtensionRuntime,
): void {
  const state = runtime_state(agent);
  state.session_extensions = resolve_extensions;
}

/** 由 City 注入完整的宿主扩展绑定。 */
export function attach_agent_host_extensions(
  agent: Agent,
  extensions: AgentHostExtensions,
): void {
  const state = runtime_state(agent);
  state.host_extensions = extensions;
}

/** 返回当前 Agent 的宿主扩展；未绑定时为空。 */
export function agent_host_extensions(agent: Agent): AgentHostExtensions | undefined {
  return runtime_state(agent).host_extensions;
}

/** 等待 City 为 Agent 绑定的扩展完成初始生命周期。 */
export async function ensure_agent_extensions_ready(agent: Agent): Promise<void> {
  await runtime_state(agent).host_extensions?.ensure_ready();
}

/** 返回当前 Agent 的 City 扩展运行时；未加入 City 时使用空实现。 */
export function resolve_agent_session_extensions(
  agent: Agent,
  workspace?: WorkspaceBase,
): SessionExtensionRuntime {
  return runtime_state(agent).session_extensions?.(workspace)
    ?? create_empty_session_extensions();
}

/** 标记 Agent 已经创建或恢复过无 City 的 Session。 */
export function mark_agent_session_started(agent: Agent): void {
  const state = runtime_state(agent);
  if (!state.host) state.memory_session_started = true;
}

export function detach_agent_host(agent: Agent, host: AgentHost): void {
  const state = runtime_state(agent);
  if (state.host === host) {
    state.host = undefined;
    state.embassy = undefined;
    state.session_extensions = undefined;
    state.host_extensions = undefined;
  }
}

export function agent_has_host(agent: Agent): boolean {
  return Boolean(runtime_state(agent).host);
}

/** 返回 City 注入的窄 Embassy 能力。 */
export function agent_embassy(agent: Agent): Embassy | undefined {
  return runtime_state(agent).embassy;
}

/** 由 Agent 释放自身时通知所属 City。 */
export async function release_agent_from_host(agent: Agent): Promise<void> {
  await runtime_state(agent).host?.release_agent(agent);
}

/** 返回 Agent 解释出的业务存储作用域。 */
export function agent_storage_scope(agent: Agent): StorageScope {
  return runtime_state(agent).storage_provider.open_scope(["agents", agent.id]);
}

/** 返回指定 Agent Plugin 的底层数据作用域。 */
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

export function create_workspace_entry(agent: Agent, workspace: WorkspaceBase): WorkspaceEntry {
  const state = runtime_state(agent);
  const workspace_id = String(workspace?.id || "").trim();
  if (!workspace_id) throw new Error("Agent sessions require a Workspace with a stable id");
  const host = state.host;
  if (host && host.get_workspace(workspace_id) !== workspace) {
    throw new Error(`Workspace "${workspace_id}" does not belong to the Agent host`);
  }
  if (!host) {
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
    if (!state.host && unbound_workspace_owners.get(entry.workspace) === agent) {
      unbound_workspace_owners.delete(entry.workspace);
    }
  }
}

export function clear_agent_runtime(agent: Agent): void {
  runtime_states.delete(agent);
}
