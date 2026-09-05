/** Group 内部运行时：连接 Group 与 City 提供的底层 Storage。 */

import type { Group } from "@/group/Group.js";
import type { GroupSessionStore } from "@/types/group/GroupSessionStore.js";
import type { StorageProvider } from "@downcity/type";
import { AgentMemoryStorageProvider } from "@/internal/AgentMemoryStorage.js";
import { LocalGroupSessionStore } from "@/group/storage/LocalGroupSessionStore.js";

interface GroupRuntimeState {
  /** Group 当前绑定的底层 Storage Provider。 */
  storage_provider: StorageProvider;
  /** Group 是否已经创建过无 City 的内存 Session。 */
  memory_session_started?: boolean;
  /** Group 是否已经绑定到 City 提供的 Storage。 */
  storage_attached?: boolean;
  /** 当前 Group 所属的 City 运行时实例。 */
  owner?: object;
  /** GroupSession 集合持久化 Store。 */
  group_session_store?: GroupSessionStore;
}

const runtime_states = new WeakMap<Group, GroupRuntimeState>();

/** 初始化 Group 内部运行时，并默认使用内存 Storage。 */
export function initialize_group_runtime(group: Group): void {
  runtime_states.set(group, { storage_provider: new AgentMemoryStorageProvider() });
}

/** 将 City 提供的 Storage 绑定到 Group。 */
export function attach_group_storage(group: Group, storage_provider: StorageProvider, owner?: object): void {
  const state = require_group_runtime(group);
  if (state.memory_session_started) {
    throw new Error(
      `Group "${group.id}" already created Session data without City; join City before creating GroupSessions`,
    );
  }
  if (state.owner && owner && state.owner !== owner) {
    throw new Error(`Group "${group.id}" already belongs to another City`);
  }
  state.storage_provider = storage_provider;
  state.storage_attached = true;
  state.owner = owner;
  state.group_session_store = undefined;
}

/** 解除 Group 与 City Storage 的绑定，允许主体重新装配到其他 City。 */
export async function detach_group_storage(group: Group, owner?: object): Promise<void> {
  const state = require_group_runtime(group);
  if (owner && state.owner && state.owner !== owner) return;
  await state.group_session_store?.dispose();
  state.group_session_store = undefined;
  state.storage_provider = new AgentMemoryStorageProvider();
  state.storage_attached = false;
  state.owner = undefined;
}

/** 获取 Group 的 GroupSession 持久化 Store。 */
export function get_group_session_store(group: Group): GroupSessionStore {
  const state = require_group_runtime(group);
  if (state.group_session_store) return state.group_session_store;
  const scope = state.storage_provider.open_scope(["groups", group.id]);
  state.group_session_store = new LocalGroupSessionStore({
    files: scope.files,
    storage_root_path: scope.root_path,
    group_id: group.id,
  });
  return state.group_session_store;
}

/** 标记 Group 已经创建或恢复过一个 GroupSession。 */
export function mark_group_session_started(group: Group): void {
  const state = require_group_runtime(group);
  if (!state.storage_attached && state.storage_provider instanceof AgentMemoryStorageProvider) {
    state.memory_session_started = true;
  }
}

/** 释放 Group 的 Store 运行时引用。 */
export async function dispose_group_runtime(group: Group): Promise<void> {
  const state = require_group_runtime(group);
  await state.group_session_store?.dispose();
  state.group_session_store = undefined;
}

function require_group_runtime(group: Group): GroupRuntimeState {
  const state = runtime_states.get(group);
  if (!state) throw new Error(`Group "${group.id}" runtime is not initialized`);
  return state;
}
