/** Group 注意力策略类型。策略只回答哪些成员需要注意当前消息。 */

import type { GroupMember, GroupMessage } from "@/types/group/Group.js";

/** 注意力决策结果。 */
export interface AttentionDecision {
  /** 被邀请注意当前消息的成员 Agent 标识。 */
  readonly member_ids: readonly string[];
}

/** Group 注意力策略协议。 */
export interface AttentionPolicy {
  /** 根据当前消息和历史选择需要注意的成员。 */
  decide_attention(input: {
    /** 当前 Group 消息。 */
    readonly message: GroupMessage;
    /** 当前 Group 历史快照。 */
    readonly messages: readonly GroupMessage[];
    /** Group 成员快照。 */
    readonly members: readonly GroupMember[];
  }): Promise<AttentionDecision> | AttentionDecision;
}

/** 默认策略：用户消息通知全部成员，Agent 消息只响应显式 @ 提及。 */
export class MentionAttentionPolicy implements AttentionPolicy {
  decide_attention(input: {
    /** 当前 Group 消息。 */
    readonly message: GroupMessage;
    /** 当前 Group 历史快照。 */
    readonly messages: readonly GroupMessage[];
    /** Group 成员快照。 */
    readonly members: readonly GroupMember[];
  }): AttentionDecision {
    const { message, members } = input;
    if (message.sender_type === "user") return { member_ids: members.map((member) => member.agent.id) };
    return {
      member_ids: members
        .map((member) => member.agent.id)
        .filter((member_id) => message.text.includes(`@${member_id}`)),
    };
  }
}
