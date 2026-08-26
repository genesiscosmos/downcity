/** Group 群聊主体的本地实现。 */

import { DefaultDispatchStrategy } from "@/types/group/DispatchStrategy.js";
import type { DispatchStrategy } from "@/types/group/DispatchStrategy.js";
import type { GroupContract, GroupMember, GroupOptions } from "@/types/group/Group.js";
import { GroupSessions } from "@/group/GroupSessions.js";
import { dispose_group_runtime, initialize_group_runtime } from "@/internal/GroupRuntime.js";

/** Group 主体：只持有身份、成员、资源引用和群聊上下文集合。 */
export class Group implements GroupContract {
  readonly id: string;
  readonly name: string;
  readonly instruction?: string;
  readonly members: readonly GroupMember[];
  readonly dispatch_strategy: DispatchStrategy;
  readonly sessions: GroupSessions;

  constructor(options: GroupOptions) {
    this.id = String(options.id || "").trim();
    if (!this.id) throw new Error("Group requires a non-empty id");
    if (!options.members?.length) throw new Error("Group requires at least one member");
    const member_ids = new Set<string>();
    this.members = Object.freeze(options.members.map((member) => {
      if (!member?.agent?.id) throw new Error("Group member requires an Agent");
      if (member_ids.has(member.agent.id)) throw new Error(`Group member already exists: ${member.agent.id}`);
      member_ids.add(member.agent.id);
      return Object.freeze({ agent: member.agent, role: member.role });
    }));
    this.name = String(options.name || this.id).trim() || this.id;
    this.instruction = options.instruction?.trim() || undefined;
    this.dispatch_strategy = options.dispatch_strategy || new DefaultDispatchStrategy();
    initialize_group_runtime(this);
    this.sessions = new GroupSessions(this);
  }

  /** 释放 Group 所拥有的全部群聊上下文。 */
  async dispose(): Promise<void> {
    await this.sessions.dispose();
    await dispose_group_runtime(this);
  }
}
