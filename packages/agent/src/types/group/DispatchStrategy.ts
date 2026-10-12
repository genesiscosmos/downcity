/**
 * Group 成员选择协议与决策模型策略。
 *
 * 每次只选择本轮需要并行回复的成员。整轮执行结束后再次判断，空集合表示回到空闲。
 * 决策模型不生成任务指令、阶段计划或聊天文本；成员根据共享对话自行执行。
 */

import type { GroupMessage } from "@/types/group/Group.js";

/** 本次成员选择的触发来源。 */
export type DispatchTrigger = "user" | "auto";

/** 判定需要的群聊身份与目标。 */
export interface DispatchGroupProfile {
  /** 当前 Group 的稳定标识。 */
  readonly group_id: string;
  /** 用户可见的群聊名称。 */
  readonly name: string;
  /** 群聊协作目标；省略时以用户消息为目标。 */
  readonly instruction?: string;
}

/** 判定需要的成员能力画像。 */
export interface DispatchMemberProfile {
  /** 成员 Agent 的稳定标识，也是选择结果引用的键。 */
  readonly agent_id: string;
  /** 用户可见的成员名称。 */
  readonly name: string;
  /** 成员擅长的工作，用于判断是否需要其回复。 */
  readonly description: string;
}

/** 一轮并行回复的成员集合。 */
export interface DispatchDecision {
  /** 本轮需要回复的成员 ID；不重复，空数组表示结束本次协作。 */
  readonly member_ids: readonly string[];
}

/** 一次成员选择所需的共享对话快照。 */
export interface DispatchInput {
  /** 当前群聊的身份与协作目标。 */
  readonly group: DispatchGroupProfile;
  /** 本次由用户消息还是完整的一轮成员回复触发。 */
  readonly trigger: DispatchTrigger;
  /** 当前批次最后一条消息。 */
  readonly current_message: GroupMessage;
  /** 当前新增批次之前的共享对话。 */
  readonly history: readonly GroupMessage[];
  /** 本次尚未判定的新增消息；自动判定时包含整轮回复。 */
  readonly pending_messages: readonly GroupMessage[];
  /** 当前可参与回复的全部成员。 */
  readonly members: readonly DispatchMemberProfile[];
  /** 停止群聊时取消当前决策调用。 */
  readonly abort_signal: AbortSignal;
}

/** 可替换的 Group 成员选择策略。 */
export interface DispatchStrategy {
  /** 根据共享对话选择本轮并行回复成员。 */
  decide_dispatch(input: DispatchInput): Promise<DispatchDecision> | DispatchDecision;
}

/** Group 使用的决策模型输入，与 Federation 的 boolean decision 协议一致。 */
export interface GroupDecisionInput {
  /** JSON 序列化的群聊上下文；不包含成员工具或执行权限。 */
  readonly state: { /** 状态载荷类型。 */ type: "text"; /** 完整判定上下文。 */ text: string };
  /** 每个成员一个是否需要回复的布尔问题。 */
  readonly questions: Array<{
    /** 对应成员的稳定 Agent ID。 */ id: string;
    /** 成员选择只需要布尔判断。 */ type: "boolean";
    /** 判断当前成员是否需要实质回复的要求。 */ instructions: string;
  }>;
}

/** Group 决策模型返回的答案；value 为 unknown，使用前严格校验。 */
export interface GroupDecisionResult {
  /** 必须恰好覆盖输入的全部问题。 */
  readonly answers: readonly {
    /** 被回答问题的成员 ID。 */ readonly question_id: string;
    /** boolean 问题的值；策略拒绝非布尔值。 */ readonly value: unknown;
  }[];
}

/** 已绑定模型 ID 和鉴权上下文的决策客户端，不依赖聊天模型协议。 */
export interface GroupDecisionModel {
  /** 执行一次结构化决策，取消信号不进入上游业务载荷。 */
  decision(input: GroupDecisionInput, signal: AbortSignal): Promise<GroupDecisionResult>;
}

/** 决策策略的构造参数。 */
export interface DecisionDispatchStrategyOptions {
  /** 用于选择本轮成员的决策客户端。 */
  readonly model?: GroupDecisionModel;
}

/** 一次决策调用选择整轮并行回复成员。 */
export class DecisionDispatchStrategy implements DispatchStrategy {
  private readonly model?: GroupDecisionModel;

  constructor(options: DecisionDispatchStrategyOptions = {}) {
    this.model = options.model;
  }

  async decide_dispatch(input: DispatchInput): Promise<DispatchDecision> {
    if (!this.model) throw new Error("Group requires a configured decision model for dispatch");
    input.abort_signal.throwIfAborted();
    const result = await this.model.decision({
      state: {
        type: "text",
        text: JSON.stringify({
          group: input.group,
          members: input.members,
          latest_user_message: input.pending_messages.filter((message) => message.sender_type === "user").at(-1)
            ?? input.history.filter((message) => message.sender_type === "user").at(-1),
          history: input.history.slice(-20),
          pending_messages: input.pending_messages,
          trigger: input.trigger,
        }),
      },
      questions: input.members.map((member) => ({
        id: member.agent_id,
        type: "boolean",
        instructions: `本轮是否需要成员 ${member.name} (${member.agent_id}) 根据其能力对当前群聊作出实质回复或行动？能力：${member.description || "未提供"}。结合用户目标和已有回复判断；可同时选择多个成员。已完成目标、重复回答、礼貌附和或没有必要的新工作时选择 false；只有需要该成员推进目标时选择 true。`,
      })),
    }, input.abort_signal);
    input.abort_signal.throwIfAborted();
    const expected_ids = new Set(input.members.map((member) => member.agent_id));
    const answers = new Map<string, boolean>();
    for (const answer of result.answers) {
      if (!expected_ids.has(answer.question_id) || answers.has(answer.question_id) || typeof answer.value !== "boolean") {
        throw new Error(`Invalid Group member decision: ${answer.question_id}`);
      }
      answers.set(answer.question_id, answer.value);
    }
    if (answers.size !== expected_ids.size) throw new Error("Group decision omitted a member");
    return { member_ids: input.members.filter((member) => answers.get(member.agent_id)).map((member) => member.agent_id) };
  }
}
