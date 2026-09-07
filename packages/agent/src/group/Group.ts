/** Group 群聊主体的本地实现。 */

import { AiDispatchStrategy } from "@/types/group/DispatchStrategy.js";
import type { DispatchStrategy } from "@/types/group/DispatchStrategy.js";
import type { ModelClient, StorageProvider } from "@downcity/type";
import type { GroupContract, GroupOptions } from "@/types/group/Group.js";
import type { Agent } from "@/agent/Agent.js";
import { GroupSessions } from "@/group/GroupSessions.js";
import { AgentMemoryStorageProvider } from "@/agent/AgentMemoryStorage.js";
import { LocalGroupSessionStore } from "@/group/storage/LocalGroupSessionStore.js";
import type { GroupSessionStore } from "@/types/group/GroupSessionStore.js";

/** Group 主体：只持有身份、成员、资源引用和群聊上下文集合。 */
export class Group implements GroupContract {
  readonly id: string;
  readonly name: string;
  readonly instruction?: string;
  readonly model?: ModelClient;
  readonly members: readonly Agent[];
  readonly dispatch_strategy: DispatchStrategy;
  readonly sessions: GroupSessions;

  /** 未加入宿主时使用的隔离进程内存储。 */
  private storage_provider: StorageProvider = new AgentMemoryStorageProvider();
  /** 当前 Group 所属宿主。 */
  private storage_owner?: object;
  /** 延迟创建的 GroupSession 持久化 Store。 */
  private session_store?: GroupSessionStore;
  /** 是否已经在无宿主存储中创建或恢复过 Session。 */
  private memory_session_started = false;

  constructor(options: GroupOptions) {
    this.id = String(options.id || "").trim();
    if (!this.id) throw new Error("Group requires a non-empty id");
    if (!options.members?.length) throw new Error("Group requires at least one member");
    const member_ids = new Set<string>();
    this.members = Object.freeze(options.members.map((member) => {
      if (!member?.id) throw new Error("Group member requires an Agent");
      if (member_ids.has(member.id)) throw new Error(`Group member already exists: ${member.id}`);
      member_ids.add(member.id);
      return member;
    }));
    this.name = String(options.name || this.id).trim() || this.id;
    this.instruction = options.instruction?.trim() || undefined;
    this.model = options.model;
    this.dispatch_strategy = options.dispatch_strategy || new AiDispatchStrategy({ model: this.model });
    this.sessions = new GroupSessions(this);
  }

  /** 将宿主存储装配到 Group；必须在使用 GroupSessions 前完成。 */
  attach(owner: object, storage_provider: StorageProvider): void {
    if (this.storage_owner) {
      if (this.storage_owner === owner) return;
      throw new Error(`Group "${this.id}" already belongs to another host`);
    }
    if (this.memory_session_started || this.session_store) {
      throw new Error(
        `Group "${this.id}" already used standalone storage; attach it before using GroupSessions`,
      );
    }
    this.storage_owner = owner;
    this.storage_provider = storage_provider;
  }

  /** 解除指定宿主的存储装配并释放当前 Store。 */
  async detach(owner: object): Promise<void> {
    if (this.storage_owner !== owner) return;
    await this.dispose_session_store();
    this.storage_owner = undefined;
    this.storage_provider = new AgentMemoryStorageProvider();
  }

  /** 获取或创建 Group 唯一的 Session Store。 */
  get_session_store(): GroupSessionStore {
    if (this.session_store) return this.session_store;
    const scope = this.storage_provider.open_scope(["groups", this.id]);
    this.session_store = new LocalGroupSessionStore({
      files: scope.files,
      storage_root_path: scope.root_path,
      group_id: this.id,
    });
    return this.session_store;
  }

  /** 标记 Group 已经创建或恢复过 Session。 */
  mark_session_started(): void {
    if (!this.storage_owner) this.memory_session_started = true;
  }

  /** 释放当前 GroupSession Store。 */
  async dispose_session_store(): Promise<void> {
    await this.session_store?.dispose();
    this.session_store = undefined;
  }

  /** 释放 Group 所拥有的全部群聊上下文。 */
  async dispose(): Promise<void> {
    await this.sessions.dispose();
  }
}
