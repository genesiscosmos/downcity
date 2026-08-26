/** GroupSessions：Group 所拥有的群聊上下文集合。 */

import { nanoid } from "nanoid";
import { GroupSession } from "@/group/GroupSession.js";
import type { Group } from "@/group/Group.js";
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
    const session = new GroupSession({
      id: `group-session-${Date.now()}-${nanoid(8)}`,
      group_id: this.group.id,
      group_name: this.group.name,
      instruction: this.group.instruction,
      members: this.group.members,
      attention_policy: this.group.attention_policy,
      ...(this.group.workspace ? { workspace: this.group.workspace } : {}),
    });
    this.sessions_by_id.set(session.id, session);
    return session;
  }

  /** 获取当前 Group 的群聊上下文。 */
  get(session_id: string): GroupSessionContract | null {
    return this.sessions_by_id.get(String(session_id || "").trim()) ?? null;
  }

  /** 列出当前 Group 的群聊上下文。 */
  list(): readonly GroupSessionContract[] {
    return [...this.sessions_by_id.values()];
  }

  /** 释放并移除指定群聊上下文。 */
  async remove(session_id: string): Promise<GroupSessionContract | null> {
    const resolved_session_id = String(session_id || "").trim();
    const session = this.sessions_by_id.get(resolved_session_id) ?? null;
    if (!session) return null;
    await session.dispose();
    this.sessions_by_id.delete(resolved_session_id);
    return session;
  }

  /** 释放 Group 所有群聊上下文。 */
  async dispose(): Promise<void> {
    await Promise.allSettled([...this.sessions_by_id.values()].map((session) => session.dispose()));
    this.sessions_by_id.clear();
  }
}
