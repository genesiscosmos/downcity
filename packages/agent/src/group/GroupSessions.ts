/** GroupSessions：Group 所拥有的可恢复群聊上下文集合。 */

import { nanoid } from "nanoid";
import { GroupSession } from "@/group/GroupSession.js";
import type { Group } from "@/group/Group.js";
import { get_group_session_store, mark_group_session_started } from "@/internal/GroupRuntime.js";
import type {
  GroupSession as GroupSessionContract,
  GroupSessionCreateInput,
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
  async create(_input?: GroupSessionCreateInput): Promise<GroupSessionContract> {
    const session = this.create_runtime_session(`group-session-${Date.now()}-${nanoid(8)}`);
    const store = get_group_session_store(this.group);
    await session.initialize(store.session(session.id));
    mark_group_session_started(this.group);
    this.sessions_by_id.set(session.id, session);
    return session;
  }

  /** 恢复当前 Group 的一个群聊上下文。 */
  async get(session_id: string): Promise<GroupSessionContract | null> {
    const resolved_session_id = String(session_id || "").trim();
    const cached = this.sessions_by_id.get(resolved_session_id);
    if (cached) return cached;
    const store = get_group_session_store(this.group);
    if (!(await store.has_session(resolved_session_id))) return null;
    const session = this.create_runtime_session(resolved_session_id);
    await session.initialize(store.session(resolved_session_id));
    mark_group_session_started(this.group);
    this.sessions_by_id.set(session.id, session);
    return session;
  }

  /** 恢复当前 Group 的全部群聊上下文。 */
  async list(): Promise<readonly GroupSessionContract[]> {
    const store = get_group_session_store(this.group);
    const metadata = await store.list_session_metadata();
    if (metadata.length > 0) mark_group_session_started(this.group);
    const sessions: GroupSessionContract[] = [];
    for (const item of metadata) {
      const existing = this.sessions_by_id.get(item.session_id);
      if (existing) {
        sessions.push(existing);
        continue;
      }
      const session = this.create_runtime_session(item.session_id);
      await session.initialize(store.session(item.session_id));
      this.sessions_by_id.set(session.id, session);
      sessions.push(session);
    }
    return sessions;
  }

  /** 释放并删除指定群聊上下文及其持久化数据。 */
  async remove(session_id: string): Promise<GroupSessionContract | null> {
    const resolved_session_id = String(session_id || "").trim();
    const session = await this.get(resolved_session_id);
    if (!session) return null;
    await session.dispose();
    await get_group_session_store(this.group).remove_session(resolved_session_id);
    this.sessions_by_id.delete(resolved_session_id);
    return session;
  }

  /** 释放 Group 所有群聊上下文。 */
  async dispose(): Promise<void> {
    await Promise.allSettled([...this.sessions_by_id.values()].map((session) => session.dispose()));
    this.sessions_by_id.clear();
    await get_group_session_store(this.group).dispose();
  }

  private create_runtime_session(session_id: string): GroupSession {
    return new GroupSession({
      id: session_id,
      group_id: this.group.id,
      group_name: this.group.name,
      instruction: this.group.instruction,
      members: this.group.members,
      attention_policy: this.group.attention_policy,
      ...(this.group.workspace ? { workspace: this.group.workspace } : {}),
    });
  }
}
