/** Group 群聊主体的本地实现。 */

import { AiDispatchStrategy } from "@/types/group/DispatchStrategy.js";
import type { DispatchStrategy } from "@/types/group/DispatchStrategy.js";
import type { ModelClient, StorageProvider, CityRuntime } from "@downcity/type";
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

  /** 未加入容器时使用的隔离进程内存储。 */
  private storage_provider: StorageProvider = new AgentMemoryStorageProvider();
  /** 当前绑定的容器运行环境；独立运行时为空。 */
  private host?: CityRuntime;
  /** 延迟创建的 GroupSession 持久化 Store。 */
  private session_store?: GroupSessionStore;

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

  /**
   * 绑定容器运行环境；必须在创建或恢复 GroupSession 前完成。
   *
   * 关键点（中文）
   * - 与 Agent 使用同一套绑定语义：只收下容器推送的存储能力，不持有容器引用。
   */
  bind(host: CityRuntime): void {
    if (this.host) {
      if (this.host === host) return;
      throw new Error(`Group "${this.id}" is already bound to another container`);
    }
    if (this.session_store) {
      throw new Error(
        `Group "${this.id}" already used standalone storage; bind it before using GroupSessions`,
      );
    }
    this.host = host;
    this.storage_provider = host.storage;
  }

  /** 解除容器绑定并释放当前 Store，主体回到独立运行状态。 */
  async unbind(): Promise<void> {
    if (!this.host) return;
    await this.dispose_session_store();
    this.host = undefined;
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

  /** 释放当前 GroupSession Store。 */
  async dispose_session_store(): Promise<void> {
    await this.session_store?.dispose();
    this.session_store = undefined;
  }

  /** 释放 Group 所拥有的全部群聊上下文。 */
  async dispose(): Promise<void> {
    if (this.host) {
      throw new Error(
        `Group "${this.id}" is bound to a container; release it with city.groups.remove(id)`,
      );
    }
    await this.sessions.dispose();
  }
}
