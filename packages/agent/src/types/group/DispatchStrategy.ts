/**
 * Group 成员选择协议与决策模型策略。
 *
 * 每次只选择本轮需要并行回复的成员。整轮执行结束后再次判断，空集合表示回到空闲。
 * 用户消息按回复概率抽样：40% 以下不回复，40%–75% 线性映射到 0–100%，75% 以上必回复。
 * 自动接力保留布尔判定，避免概率抽样延长已完成的协作。
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
  /** 默认策略逐成员的概率和抽样记录；自定义策略可省略。 */
  readonly member_decisions?: readonly DispatchMemberDecision[];
}

/** 单个成员的决策与抽样事实，用于解释选中或未选中的原因。 */
export interface DispatchMemberDecision {
  /** 本次判定对应的群成员 ID。 */
  readonly agent_id: string;
  /** 决策模型原始布尔结论。 */
  readonly value: boolean;
  /** 模型对所选布尔结论的置信度；未提供时省略。 */
  readonly probability?: number;
  /** 从布尔结论和置信度还原的回复概率；未提供置信度时省略。 */
  readonly reply_probability?: number;
  /** 本轮实际使用的回复率；自动轮次为布尔结论对应的 0 或 1。 */
  readonly selection_probability: number;
  /** 仅在概率介于 0 与 1 之间时生成的随机数，范围为 [0, 1)。 */
  readonly random_value?: number;
  /** 本轮是否选中该成员。 */
  readonly selected: boolean;
}

/** 一次成员选择所需的共享对话快照。 */
export interface DispatchInput {
  /** 当前群聊的身份与协作目标。 */
  readonly group: DispatchGroupProfile;
  /** 本次由用户消息还是完整的一轮成员回复触发。 */
  readonly trigger: DispatchTrigger;
  /** 当前批次最新用户消息；自动轮次为批次最后一条成员消息。 */
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
    /** 所选 value 的置信度，范围为 0–1；用户消息调度必须提供，false 时用 1 - probability 还原回复概率。 */
    readonly probability?: number;
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
          current_message: input.current_message,
          priorities: "最新用户请求优先于群聊长期目标。问候、确认在线和身份询问只需简短回应，不授权开发、创建文档或启动新工作。群成员仅限 members 中的成员。",
          recent_speaker_ids: [...new Set(input.pending_messages.filter((message) => message.sender_type === "agent").map((message) => message.sender_id))],
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
        instructions: `本轮是否应该由成员 ${member.name} (${member.agent_id}) 回复当前群聊？成员能力：${member.description || "未提供"}。可同时选择多个成员。${input.trigger === "user"
          ? "本轮由用户新消息触发。用户对该成员的直接提问、点名或 @、问候、确认在线、澄清和与成员能力相关的请求，都应选择 true，即使回复只是简短确认。仅当消息与该成员无关、已经被充分回答、明显重复，或用户明确不需要回复时选择 false。"
          : "本轮由成员回复触发，默认选择 false。只有用户明确请求的工作尚未完成，且新增回复明确向该成员交接必要工作、提出该成员需要回答的问题，或该成员有明确尚未完成的已授权任务时，才选择 true。成员刚回复过时，继续选中自己必须有明确未完成工作，不能因为自己的泛泛邀请、计划、可继续做、询问用户需求而继续。问候、确认在线、介绍成员、等待用户提供需求、已有回答充分时，所有成员选择 false。群聊长期目标不构成自行开启工作的授权。"}`,
      })),
    }, input.abort_signal);
    input.abort_signal.throwIfAborted();
    const expected_ids = new Set(input.members.map((member) => member.agent_id));
    const answers = new Map<string, GroupDecisionResult["answers"][number]>();
    for (const answer of result.answers) {
      if (!expected_ids.has(answer.question_id) || answers.has(answer.question_id) || typeof answer.value !== "boolean") {
        throw new Error(`Invalid Group member decision: ${answer.question_id}`);
      }
      if ((input.trigger === "user" || answer.probability !== undefined) && (
        typeof answer.probability !== "number" || !Number.isFinite(answer.probability)
        || answer.probability < 0 || answer.probability > 1
      )) {
        throw new Error(`Invalid Group member decision probability: ${answer.question_id}`);
      }
      answers.set(answer.question_id, answer);
    }
    if (answers.size !== expected_ids.size) throw new Error("Group decision omitted a member");
    const member_decisions: DispatchMemberDecision[] = input.members.map((member) => {
      const answer = answers.get(member.agent_id)!;
      const value = answer.value as boolean;
      // probability 是所选结论的置信度，不能把高置信度的 false 当作高回复概率。
      const reply_probability = answer.probability === undefined ? undefined
        : value ? answer.probability : 1 - answer.probability;
      const selection_probability = input.trigger === "auto" ? Number(value)
        : Math.max(0, Math.min(1, (reply_probability! - 0.4) / (0.75 - 0.4)));
      const random_value = selection_probability > 0 && selection_probability < 1 ? Math.random() : undefined;
      return {
        agent_id: member.agent_id,
        value,
        ...(answer.probability !== undefined ? { probability: answer.probability, reply_probability } : {}),
        selection_probability,
        ...(random_value !== undefined ? { random_value } : {}),
        selected: selection_probability === 1 || (random_value !== undefined && random_value < selection_probability),
      };
    });
    return {
      member_ids: member_decisions.filter((decision) => decision.selected).map((decision) => decision.agent_id),
      member_decisions,
    };
  }
}
