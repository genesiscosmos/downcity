/**
 * Group：具有集体主体性的协作主体。
 *
 * Group 只拥有成员关系与 GroupSession；它不直接执行模型、不拥有 Workspace，
 * GroupSession 中的实际执行由成员 Agent 自己的 AgentSession 完成。
 */

import { GroupSessionsImpl } from "@/group/GroupSessions.js";
import type {
  GroupMember,
  GroupOptions,
  GroupSessions,
} from "@/types/group/Group.js";

/** SDK Group 主体。 */
export class Group {
  /** Group 稳定标识。 */
  readonly id: string;
  /** Group 展示名称。 */
  readonly name: string;
  /** Group 协作目标指令。 */
  readonly instruction?: string;
  /** Group 成员稳定快照。 */
  readonly members: readonly GroupMember[];
  /** 默认执行成员。 */
  readonly coordinator_id?: string;
  /** Group 拥有的共享协作 Session 集合。 */
  readonly sessions: GroupSessions;
  /** Group 内部持有的 Session 生命周期管理器。 */
  private readonly session_manager: GroupSessionsImpl;

  constructor(options: GroupOptions) {
    this.id = String(options.id || "").trim();
    if (!this.id) throw new Error("Group requires a non-empty id");
    if (!options.members?.length) throw new Error("Group requires at least one member");
    const members = options.members.map((member) => {
      if (!member?.agent?.id) throw new Error("Group member requires an Agent");
      return Object.freeze({ agent: member.agent, role: member.role });
    });
    const member_ids = new Set<string>();
    for (const member of members) {
      if (member_ids.has(member.agent.id)) {
        throw new Error(`Group member already exists: ${member.agent.id}`);
      }
      member_ids.add(member.agent.id);
    }
    this.name = String(options.name || this.id).trim() || this.id;
    this.instruction = options.instruction?.trim() || undefined;
    this.members = Object.freeze(members);
    this.coordinator_id = options.coordinator_id?.trim() || members[0]?.agent.id;
    if (this.coordinator_id && !member_ids.has(this.coordinator_id)) {
      throw new Error(`Group coordinator is not a member: ${this.coordinator_id}`);
    }
    this.session_manager = new GroupSessionsImpl(this);
    this.sessions = this.session_manager;
  }

  /**
   * 由 City 注入 Workspace 资源校验；Group 本身不依赖 City 类型。
   *
   * 该方法是内部组合协议，不从 package 根入口导出。
   */
  bind_workspace_resolver(resolver: (workspace_id: string) => boolean): void {
    this.session_manager.bind_workspace_resolver(resolver);
  }

  /** 返回指定成员；不存在时返回 null。 */
  get_member(agent_id: string) {
    const resolved_agent_id = String(agent_id || "").trim();
    return this.members.find((member) => member.agent.id === resolved_agent_id)?.agent ?? null;
  }

  /** 释放 GroupSession 中正在执行的成员 AgentSession。 */
  async dispose(): Promise<void> {
    await this.session_manager.dispose();
  }
}
