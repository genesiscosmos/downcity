/**
 * GroupSessions：Group 唯一的共享 Session 集合。
 */

import { GroupSessionImpl } from "@/group/GroupSession.js";
import type { Group } from "@/group/Group.js";
import type {
  GroupCreateSessionOptions,
  GroupSession,
  GroupSessions,
} from "@/types/group/Group.js";

/** GroupSession 的本地拥有者集合。 */
export class GroupSessionsImpl implements GroupSessions {
  private readonly sessions_by_id = new Map<string, GroupSessionImpl>();
  private readonly group: Group;
  private workspace_resolver?: (workspace_id: string) => boolean;

  constructor(group: Group) {
    this.group = group;
  }

  /** 绑定 City 提供的 Workspace 资源校验。 */
  bind_workspace_resolver(resolver: (workspace_id: string) => boolean): void {
    this.workspace_resolver = resolver;
  }

  /** 创建并持有一个 GroupSession。 */
  async create(input?: GroupCreateSessionOptions): Promise<GroupSession> {
    if (input?.workspace && !this.workspace_resolver?.(input.workspace.id)) {
      throw new Error(
        `Workspace "${input.workspace.id}" is not provided by the City hosting Group "${this.group.id}"`,
      );
    }
    const session = new GroupSessionImpl({
      group: this.group,
      workspace: input?.workspace,
      on_dispose: (session_id) => this.sessions_by_id.delete(session_id),
    });
    this.sessions_by_id.set(session.id, session);
    return session;
  }

  /** 获取一个已创建的 GroupSession。 */
  get(session_id: string): GroupSession | null {
    return this.sessions_by_id.get(String(session_id || "").trim()) ?? null;
  }

  /** 返回 GroupSession 稳定快照。 */
  list(): readonly GroupSession[] {
    return [...this.sessions_by_id.values()];
  }

  /** 停止并释放全部 GroupSession。 */
  async dispose(): Promise<void> {
    await Promise.allSettled(
      [...this.sessions_by_id.values()].map(async (session) => await session.dispose()),
    );
    this.sessions_by_id.clear();
  }
}
