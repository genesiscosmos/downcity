/** Group 调度策略：决定一条消息本轮由谁发言以及是否继续传播。 */

import type { GroupMember, GroupMessage } from "@/types/group/Group.js";

/** 本轮成员的发言方式。 */
export type DispatchResponseMode = "single" | "parallel";

/** 本轮 Agent 回复后的传播方式。 */
export type DispatchContinuation = "stop" | "mention" | "dispatch";

/** 一次 Group 消息调度结果。 */
export interface DispatchDecision {
  /** 本轮允许被唤醒的成员 Agent 标识，顺序代表优先级。 */
  readonly member_ids: readonly string[];
  /** 本轮只允许首个成员发言，还是允许全部成员分别发言。 */
  readonly response_mode: DispatchResponseMode;
  /** 本轮成员回复后是否继续寻找下一批成员。 */
  readonly continuation: DispatchContinuation;
  /** 注入成员 AgentSession 的发言约束。 */
  readonly instruction: string;
  /** 无法安全调度时给用户的澄清文本。 */
  readonly clarification?: string;
}

/** Group 调度策略协议。 */
export interface DispatchStrategy {
  /** 根据当前消息、历史和成员关系决定本轮发言者。 */
  decide_dispatch(input: {
    /** 当前待调度的 Group 消息。 */
    readonly message: GroupMessage;
    /** 当前 Group 已存在的消息历史。 */
    readonly messages: readonly GroupMessage[];
    /** 当前 Group 成员快照。 */
    readonly members: readonly GroupMember[];
  }): Promise<DispatchDecision> | DispatchDecision;
}

/** 默认人类群聊调度：明确对象优先，歧义时要求用户澄清。 */
export class DefaultDispatchStrategy implements DispatchStrategy {
  decide_dispatch(input: {
    /** 当前待调度的 Group 消息。 */
    readonly message: GroupMessage;
    /** 当前 Group 已存在的消息历史。 */
    readonly messages: readonly GroupMessage[];
    /** 当前 Group 成员快照。 */
    readonly members: readonly GroupMember[];
  }): DispatchDecision {
    const { message, members } = input;
    const collective = /你们|大家|各自|分别|同时|一起|所有人/.test(message.text);
    const mentioned_ids = members
      .map((member) => member.agent.id)
      .filter((member_id) => message.text.includes(`@${member_id}`));

    if (message.sender_type === "agent") {
      return {
        member_ids: mentioned_ids,
        response_mode: "parallel",
        continuation: "mention",
        instruction: "只在明确被提及时回复；只代表自己发言，不替其他成员发言，不创建协调者或裁判。",
      };
    }

    if (mentioned_ids.length > 0) {
      return {
        member_ids: mentioned_ids,
        response_mode: collective || mentioned_ids.length > 1 ? "parallel" : "single",
        continuation: "stop",
        instruction: collective
          ? "只回答你自己的部分，不替其他成员发言，不分配角色，不创建协调者。"
          : "只回答用户明确交给你的问题，不替其他成员发言。",
      };
    }

    if (collective) {
      return {
        member_ids: members.map((member) => member.agent.id),
        response_mode: "parallel",
        continuation: "stop",
        instruction: "只回答你自己的部分，不替其他成员发言，不分配角色，不创建协调者。",
      };
    }

    const matched_ids = members
      .filter((member) => {
        const role = member.role?.trim();
        return Boolean(role && message.text.toLowerCase().includes(role.toLowerCase()));
      })
      .map((member) => member.agent.id);
    if (matched_ids.length === 1) {
      return {
        member_ids: matched_ids,
        response_mode: "single",
        continuation: "stop",
        instruction: "只回答用户当前问题，不替其他成员发言。",
      };
    }

    if (members.length === 1) {
      return {
        member_ids: [members[0].agent.id],
        response_mode: "single",
        continuation: "stop",
        instruction: "只回答用户当前问题，只代表自己发言。",
      };
    }

    return {
      member_ids: [],
      response_mode: "single",
      continuation: "stop",
      instruction: "不要在对象不明确时猜测或代替其他成员发言。",
      clarification: "请明确指定需要回答的成员，或说明是否需要所有成员分别回答。",
    };
  }
}
