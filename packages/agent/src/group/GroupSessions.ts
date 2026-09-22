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
  GroupSessions as GroupSessionsContract,
} from "@/types/group/GroupSession.js";

/** Group 的群聊上下文集合。 */
export class GroupSessions implements GroupSessionsContract {
  private readonly group: Group;
  private readonly sessions_by_id = new Map<string, GroupSession>();

  constructor(group: Group) {
    this.group = group;
  }

  /** 创建一个新的群聊上下文，session_id 由内部生成。 */
  async create(input?: GroupSessionCreateInput): Promise<GroupSessionContract> {
    const session = this.create_runtime_session(`group-session-${Date.now()}-${nanoid(8)}`, input?.workspace);
    const store = this.group.get_session_store();
    await session.initialize(store.session(session.id));
    this.sessions_by_id.set(session.id, session);
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
    this.sessions_by_id.set(session.id, session);
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
    this.sessions_by_id.delete(resolved_session_id);
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
    return await this.group.get_session_store().archive_session(resolved_session_id);
  }

  /** 列出已归档的群聊上下文摘要。 */
  async archived(input?: GroupSessionArchiveListInput): Promise<readonly GroupSessionSummary[]> {
    const metadata = await this.group.get_session_store().list_archived_session_metadata();
    return to_summaries(metadata, input?.workspace_id);
  }

  /** 永久清空当前 Group 的全部归档。 */
  async clean_archive(): Promise<GroupSessionCleanArchiveResult> {
    return await this.group.get_session_store().clean_archive();
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
    this.sessions_by_id.clear();
    await this.group.dispose_session_store();
  }

  private create_runtime_session(session_id: string, workspace?: WorkspaceRuntime): GroupSession {
    return new GroupSession({
      id: session_id,
      group_id: this.group.id,
      group_name: this.group.name,
      instruction: this.group.instruction,
      model: this.group.model,
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
