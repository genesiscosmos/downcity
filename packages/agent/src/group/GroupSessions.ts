/** GroupSessions：Group 所拥有的可恢复群聊上下文集合。 */

import { nanoid } from "nanoid";
import { GroupSession } from "@/group/GroupSession.js";
import type { Group } from "@/group/Group.js";
import type { WorkspaceRuntime } from "@downcity/type";
import type { GroupSessionHistoryMeta } from "@/types/group/GroupSessionStore.js";
import type {
  GroupSession as GroupSessionContract,
  GroupSessionArchiveListInput,
  GroupSessionArchiveResult,
  GroupSessionCleanArchiveResult,
  GroupSessionCreateInput,
  GroupSessionGetInput,
  GroupSessionListInput,
  GroupSessionSummary,
  GroupEvent,
  GroupSessions as GroupSessionsContract,
} from "@/types/group/GroupSession.js";

/** Group 的群聊上下文集合。 */
export class GroupSessions implements GroupSessionsContract {
  private readonly group: Group;
  private readonly sessions_by_id = new Map<string, GroupSession>();
  /** 合并并发自身会话打开，防止重复初始化同一份存储。 */
  private self_pending?: Promise<GroupSessionContract>;

  /** 集合事实观察器覆盖已恢复和未来加载的实例，不依赖页面订阅。 */
  private readonly event_listeners = new Set<(session_id: string, event: GroupEvent) => void | Promise<void>>();
  private readonly removal_listeners = new Set<(session_id: string, reason: "archived" | "removed") => void | Promise<void>>();
  /** 活动和归档目录发生变化的事实，不携带通知策略。 */
  private readonly directory_listeners = new Set<() => void | Promise<void>>();
  private readonly event_releases = new Map<string, () => void>();

  /** 订阅集合中的原始运行事件；不在 Agent 层解释通知业务规则。 */
  on_event(listener: (session_id: string, event: GroupEvent) => void | Promise<void>): () => void {
    this.event_listeners.add(listener);
    return () => { this.event_listeners.delete(listener); };
  }

  /** 成功归档或删除后通知 City，供其维护目标生命周期。 */
  on_removed(listener: (session_id: string, reason: "archived" | "removed") => void | Promise<void>): () => void {
    this.removal_listeners.add(listener);
    return () => { this.removal_listeners.delete(listener); };
  }

  /** 观察创建和归档清空等目录变化；返回精确释放函数。 */
  on_directory_changed(listener: () => void | Promise<void>): () => void {
    this.directory_listeners.add(listener);
    return () => { this.directory_listeners.delete(listener); };
  }

  private async notify_directory_changed(): Promise<void> {
    await Promise.allSettled([...this.directory_listeners].map((listener) => listener()));
  }

  private cache_session(session: GroupSession): void {
    this.sessions_by_id.set(session.id, session);
    this.event_releases.get(session.id)?.();
    this.event_releases.set(session.id, session.subscribe(async (event) => {
      await Promise.all([...this.event_listeners].map((listener) => listener(session.id, event)));
    }));
  }

  private async release_session(session_id: string, reason: "archived" | "removed"): Promise<void> {
    this.event_releases.get(session_id)?.();
    this.event_releases.delete(session_id);
    this.sessions_by_id.delete(session_id);
    await Promise.all([...this.removal_listeners].map((listener) => listener(session_id, reason)));
  }

  constructor(group: Group) {
    this.group = group;
  }

  /** 打开固定自身会话；并发请求共享初始化，且必须使用同一个 Workspace。 */
  async self(input?: GroupSessionCreateInput): Promise<GroupSessionContract> {
    if (!this.self_pending) {
      this.self_pending = this.open_self(input);
    }
    const operation = this.self_pending;
    try {
      const session = await operation;
      if (session.workspace_id !== input?.workspace?.id) {
        throw new Error(`GroupSession "${this.group.id}" is bound to another Workspace`);
      }
      return session;
    } finally {
      if (this.self_pending === operation) this.self_pending = undefined;
    }
  }

  /** 恢复或初始化 group_id 对应的唯一自身会话。 */
  private async open_self(input?: GroupSessionCreateInput): Promise<GroupSessionContract> {
    const existing = await this.get(this.group.id, input);
    if (existing) return existing;
    const session = this.create_runtime_session(this.group.id, input?.workspace);
    await session.initialize(this.group.get_session_store().session(session.id));
    this.cache_session(session);
    await this.notify_directory_changed();
    return session;
  }

  /** 创建一个新的群聊上下文，session_id 由内部生成。 */
  async create(input?: GroupSessionCreateInput): Promise<GroupSessionContract> {
    const session = this.create_runtime_session(`group-session-${Date.now()}-${nanoid(8)}`, input?.workspace);
    const store = this.group.get_session_store();
    await session.initialize(store.session(session.id));
    this.cache_session(session);
    await this.notify_directory_changed();
    return session;
  }

  /** 恢复当前 Group 的一个群聊上下文。 */
  async get(session_id: string, input?: GroupSessionGetInput): Promise<GroupSessionContract | null> {
    const resolved_session_id = String(session_id || "").trim();
    const cached = this.sessions_by_id.get(resolved_session_id);
    if (cached) {
      if (cached.workspace_id !== input?.workspace?.id) {
        throw new Error(`GroupSession "${resolved_session_id}" is bound to another Workspace`);
      }
      return cached;
    }
    const store = this.group.get_session_store();
    if (!(await store.has_session(resolved_session_id))) return null;
    const session = this.create_runtime_session(resolved_session_id, input?.workspace);
    await session.initialize(store.session(resolved_session_id));
    this.cache_session(session);
    return session;
  }

  /** 恢复当前 Group 的全部群聊上下文（不含已归档）。 */
  async list(input?: GroupSessionListInput): Promise<readonly GroupSessionSummary[]> {
    const metadata = await this.group.get_session_store().list_session_metadata();
    return to_summaries(metadata, input?.workspace_id);
  }

  /** 释放并删除指定群聊上下文及其持久化数据。 */
  async remove(session_id: string, input?: GroupSessionGetInput): Promise<GroupSessionContract | null> {
    const resolved_session_id = String(session_id || "").trim();
    const session = await this.get(resolved_session_id, input);
    if (!session) return null;
    await session.dispose();
    await this.group.get_session_store().remove_session(resolved_session_id);
    await this.release_session(resolved_session_id, "removed");
    return session;
  }

  /**
   * 归档指定群聊上下文：从活动区迁入归档区。
   *
   * 与 `remove` 的区别是**可逆性**：归档只是收起来，数据仍在归档区；
   * 而 `remove` 是永久删除。
   *
   * 归档前必须 `dispose` 运行时实例：否则内存里的实例会继续往旧路径（活动区）写，
   * 而那份目录已经不存在了。`dispose` 失败不阻止归档——实例已经跑不起来了，
   * 而用户想归档的意图不该因此落空。
   */
  async archive(session_id: string): Promise<GroupSessionArchiveResult> {
    const resolved_session_id = String(session_id || "").trim();
    if (!resolved_session_id) throw new Error("GroupSessions.archive requires a non-empty session_id");
    const cached = this.sessions_by_id.get(resolved_session_id);
    if (cached) {
      await cached.dispose();
      this.sessions_by_id.delete(resolved_session_id);
    }
    const result = await this.group.get_session_store().archive_session(resolved_session_id);
    await this.release_session(resolved_session_id, "archived");
    return result;
  }

  /** 列出已归档的群聊上下文摘要。 */
  async archived(input?: GroupSessionArchiveListInput): Promise<readonly GroupSessionSummary[]> {
    const metadata = await this.group.get_session_store().list_archived_session_metadata();
    return to_summaries(metadata, input?.workspace_id);
  }

  /** 永久清空当前 Group 的全部归档。 */
  async clean_archive(): Promise<GroupSessionCleanArchiveResult> {
    const result = await this.group.get_session_store().clean_archive();
    await this.notify_directory_changed();
    return result;
  }

  /**
   * 永久删除当前 Group 的全部群聊数据（活动区 + 归档区）。
   *
   * 它服务于「Group 被删除」：Group 是群聊的**所有者**，所有者消失时它拥有的数据
   * 不该继续存在。与 `dispose` 的区别：那个只释放运行时实例，数据仍在磁盘上。
   *
   * 先释放运行时实例再删目录：实例还活着时删掉它的数据目录，
   * 之后任何写入都会落到一个已经不存在的位置。
   */
  async purge(): Promise<void> {
    await Promise.allSettled([...this.sessions_by_id.values()].map((session) => session.dispose()));
    this.sessions_by_id.clear();
    await this.group.get_session_store().purge();
  }

  /** 释放 Group 所有群聊上下文。 */
  async dispose(): Promise<void> {
    await Promise.allSettled([...this.sessions_by_id.values()].map((session) => session.dispose()));
    for (const release of this.event_releases.values()) release();
    this.event_releases.clear();
    this.sessions_by_id.clear();
    await this.group.dispose_session_store();
  }

  private create_runtime_session(session_id: string, workspace?: WorkspaceRuntime): GroupSession {
    return new GroupSession({
      id: session_id,
      group_id: this.group.id,
      group_name: this.group.name,
      instruction: this.group.instruction,
      model: this.group.members.find((member) => member.model)?.model,
      members: this.group.members,
      dispatch_strategy: this.group.dispatch_strategy,
      ...(workspace ? { workspace } : {}),
    });
  }
}

/**
 * 把 metadata 投影成列表摘要，并按 Workspace 过滤。
 *
 * 活动列表与归档列表共用这一段：两处各写一遍必然分叉，
 * 而分叉的表现是「归档后摘要少了字段」这类很难一眼看出的差异。
 */
function to_summaries(
  metadata: readonly GroupSessionHistoryMeta[],
  workspace_id_input?: string,
): readonly GroupSessionSummary[] {
  const workspace_id = String(workspace_id_input || "").trim() || undefined;
  return metadata
    .filter((item) => !workspace_id || item.workspace_id === workspace_id)
    .map((item) => ({
      id: item.session_id,
      group_id: item.group_id,
      created_at: item.created_at,
      updated_at: item.updated_at,
      message_count: item.message_count,
      ...(item.workspace_id ? { workspace_id: item.workspace_id } : {}),
      ...(item.title ? { title: item.title } : {}),
      ...(item.preview_text ? { preview_text: item.preview_text } : {}),
    }));
}
