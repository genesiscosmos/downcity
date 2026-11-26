/**
 * Group 成员选择协议与决策模型策略。
 *
 * 每次只选择本轮需要并行回复的成员。整轮执行结束后再次判断，空集合表示回到空闲。
 * 用户轮优先选择双因子 true 概率均严格大于 50% 的成员；空闲输入无人达标时兜底一位。
 * 自动接力保留保守的布尔判定。所有选择均为确定性规则，不做随机抽样。
 * 决策模型不生成任务指令、阶段计划或聊天文本；成员根据共享对话自行执行。
 */

import type { GroupMessage } from "@/types/group/Group.js";
import { find_idle_fallback_member } from "@/group/IdleFallbackSelection.js";

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
  /** 成员的个人化姓名。 */
  readonly name: string;
  /** 可选身份与角色列表；去除首尾空白、空项和重复项，空列表表示无角色。 */
  readonly role?: string[];
  /** 成员擅长的工作，用于判断是否需要其回复。 */
  readonly description: string;
}

/** 一轮并行回复的成员集合。 */
export interface DispatchDecision {
  /** 本轮需要回复的成员 ID；不重复，空数组表示结束本次协作。 */
  readonly member_ids: readonly string[];
  /** 默认策略逐成员的因子判断和选择记录；自定义策略可省略。 */
  readonly member_decisions?: readonly DispatchMemberDecision[];
}

/** 布尔判断的审计事实；自动接力允许模型省略置信度。 */
export interface DispatchBooleanDecision {
  /** 模型对当前问题返回的原始布尔结论。 */
  readonly value: boolean;
  /** 所选 value 的置信度，范围为 0–1；模型未提供时省略。 */
  readonly probability?: number;
  /** 问题为 true 的概率：value 为 false 时取 1 - probability；无置信度时省略。 */
  readonly true_probability?: number;
}

/** 用户轮单个因子的完整判断，必须提供概率供确定性门槛使用。 */
export interface DispatchFactorDecision extends DispatchBooleanDecision {
  /** 模型对原始布尔结论的置信度，范围为 0–1。 */
  readonly probability: number;
  /** 还原后的 true 概率，必须严格大于 0.5 才通过该因子。 */
  readonly true_probability: number;
}

/** 逐成员的确定性选择记录；触发类型决定所需的审计因子。 */
export type DispatchMemberDecision = {
  /** 本次判定对应的群成员 ID。 */
  readonly agent_id: string;
  /** 用户消息触发，分别判断相关性和本轮回应需要。 */
  readonly trigger: "user";
  /** 当前话题与成员能力、身份或正在参与的对话是否相关。 */
  readonly relevance: DispatchFactorDecision;
  /** 用户此刻是否期待该成员回应，或该成员是否仍有必要回应。 */
  readonly response_need: DispatchFactorDecision;
  /** 两项 true 概率均严格大于 0.5，或该成员被空闲兜底选中时为 true。 */
  readonly selected: boolean;
  /** 仅在用户空闲输入且全员未达阈值时，为确定性兜底选中的成员标记 true。 */
  readonly idle_fallback?: true;
} | {
  /** 本次判定对应的群成员 ID。 */
  readonly agent_id: string;
  /** 成员回复触发，仅处理必要接力。 */
  readonly trigger: "auto";
  /** 是否有必要交接或明确未完成的已授权工作；按原始布尔结论执行。 */
  readonly continuation: DispatchBooleanDecision;
  /** 与 continuation.value 一致，不应用用户轮的概率门槛。 */
  readonly selected: boolean;
};

/** 一次成员选择所需的共享对话快照。 */
export interface DispatchInput {
  /** 当前群聊的身份与协作目标。 */
  readonly group: DispatchGroupProfile;
  /** 本次由用户消息还是完整的一轮成员回复触发。 */
  readonly trigger: DispatchTrigger;
  /** 本批含在无成员执行或等待交互时到达的用户消息；默认策略无人达标时至少选一位。自定义策略自行处理此约束。 */
  readonly require_response?: boolean;
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

/** Group 使用的决策模型输入，与 Downtown 的 boolean decision 协议一致。 */
export interface GroupDecisionInput {
  /** JSON 序列化的群聊上下文；不包含成员工具或执行权限。 */
  readonly state: { /** 状态载荷类型。 */ type: "text"; /** 完整判定上下文。 */ text: string };
  /** 用户轮每个成员两个因子问题；自动轮每个成员一个接力问题。 */
  readonly questions: Array<{
    /** 问题稳定标识；用户轮由成员 ID 与因子编码，自动轮为成员 ID。 */ id: string;
    /** 成员选择只需要布尔判断。 */ type: "boolean";
    /** 当前因子或自动接力的布尔判定要求。 */ instructions: string;
  }>;
}

/** Group 决策模型返回的答案；value 为 unknown，使用前严格校验。 */
export interface GroupDecisionResult {
  /** 必须恰好覆盖输入的全部问题。 */
  readonly answers: readonly {
    /** 必须与输入 questions 中某个问题的 id 完全一致。 */ readonly question_id: string;
    /** boolean 问题的值；策略拒绝非布尔值。 */ readonly value: unknown;
    /** 所选 value 的置信度，范围为 0–1；用户轮两个因子均必须提供，false 时用 1 - probability 还原 true 概率。 */
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
    const questions = input.members.flatMap((member) => create_member_questions(member, input.trigger));
    const result = await this.model.decision({
      state: {
        type: "text",
        text: JSON.stringify({
          group: input.group,
          members: input.members,
          current_message: input.current_message,
          priorities: "最新用户请求优先于群聊长期目标。问候、确认在线和身份询问只需简短回应，不授权开发、创建文档或启动新工作。群成员仅限 members 中的成员。",
          conversation_rules: "无 @ 的群内提问默认面向全群，按成员能力、身份和对话参与关系判断相关性。你俩、继续、再来一次等指代继承最近相关对话的参与者，不要求重新点名。问候、闲聊和游戏也可以需要回应，不要求提供新知识。",
          recent_speaker_ids: [...new Set([...input.history.slice(-20), ...input.pending_messages].filter((message) => message.sender_type === "agent").map((message) => message.sender_id))],
          latest_user_message: input.pending_messages.filter((message) => message.sender_type === "user").at(-1)
            ?? input.history.filter((message) => message.sender_type === "user").at(-1),
          history: input.history.slice(-20),
          pending_messages: input.pending_messages,
          trigger: input.trigger,
        }),
      },
      questions,
    }, input.abort_signal);
    input.abort_signal.throwIfAborted();
    const expected_ids = new Set(questions.map((question) => question.id));
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
    if (answers.size !== expected_ids.size) throw new Error("Group decision omitted a question");
    const member_decisions: DispatchMemberDecision[] = input.members.map((member) => {
      if (input.trigger === "user") {
        const relevance = read_factor_decision(answers.get(factor_question_id(member.agent_id, "relevance"))!);
        const response_need = read_factor_decision(answers.get(factor_question_id(member.agent_id, "response_need"))!);
        return {
          agent_id: member.agent_id,
          trigger: "user",
          relevance,
          response_need,
          selected: relevance.true_probability > 0.5 && response_need.true_probability > 0.5,
        };
      }
      const continuation = read_boolean_decision(answers.get(member.agent_id)!);
      return { agent_id: member.agent_id, trigger: "auto", continuation, selected: continuation.value };
    });
    const fallback_member_id = find_idle_fallback_member(member_decisions, input.trigger === "user" && input.require_response === true);
    const final_decisions = member_decisions.map((decision) => decision.trigger === "user" && decision.agent_id === fallback_member_id
      ? { ...decision, selected: true, idle_fallback: true as const }
      : decision);
    return {
      member_ids: final_decisions.filter((decision) => decision.selected).map((decision) => decision.agent_id),
      member_decisions: final_decisions,
    };
  }
}

/** 无歧义地编码成员与因子，成员 ID 含分隔符时也不会冲突。 */
function factor_question_id(agent_id: string, factor: "relevance" | "response_need"): string {
  return JSON.stringify([agent_id, factor]);
}

/** 用户轮分开询问两个因子；自动轮只询问是否有必要接力。 */
function create_member_questions(member: DispatchMemberProfile, trigger: DispatchTrigger): GroupDecisionInput["questions"] {
  const identity = `成员 ${member.name} (${member.agent_id})；角色：${member.role?.join("、") || "未提供"}；能力：${member.description || "未提供"}。`;
  if (trigger === "auto") {
    return [{
      id: member.agent_id,
      type: "boolean",
      instructions: `本轮是否应该由该成员继续回复当前群聊？${identity}可同时选择多个成员。本轮由成员回复触发，默认选择 false。只有用户明确请求的工作尚未完成，且新增回复明确向该成员交接必要工作、提出该成员需要回答的问题，或该成员有明确尚未完成的已授权任务时，才选择 true。成员刚回复过时，继续选中自己必须有明确未完成工作，不能因为自己的泛泛邀请、计划、可继续做、询问用户需求而继续。问候、确认在线、介绍成员、等待用户提供需求、已有回答充分时，所有成员选择 false。群聊长期目标不构成自行开启工作的授权。`,
    }];
  }
  return [{
    id: factor_question_id(member.agent_id, "relevance"),
    type: "boolean",
    instructions: `当前用户消息是否与该成员相关？${identity}仅判断相关性，与是否还需要回应分开。能力、身份或正在参与的对话任一相关即可为 true，不限于专业任务。无 @ 的群内提问默认面向全群，按成员能力、身份和对话参与关系判断，不把未点名当作无关。面向全群的问候、闲聊和游戏对适用成员也相关；直接点名或 @ 与该成员相关。你俩、继续、再来一次继承最近相关对话的参与者，结合历史识别对象，不要求重新 @。明显与该成员无关时为 false。`,
  }, {
    id: factor_question_id(member.agent_id, "response_need"),
    type: "boolean",
    instructions: `用户此刻是否期待该成员回应，或该成员是否仍有必要回应？${identity}仅判断本轮回应需要，与话题是否相关分开。用户直接提问、面向群里的意见征询、问候、确认在线、澄清、继续请求、必要交接和未完成的已授权回应都可以为 true。无 @ 的群内提问默认面向全群；你俩、继续、再来一次继承最近相关对话的参与者。问候、闲聊和游戏不要求有新知识贡献，简短确认或继续参与即可。历史中上一轮已完成不表示用户本轮的继续请求也已完成。当前请求已经被充分回答、只会重复已有回答、用户明确只问其他成员或明确无需回应时为 false。群聊长期目标不构成新工作的授权。`,
  }];
}

/** 在严格校验答案后还原 true 概率；置信度始终针对所选布尔结论。 */
function read_boolean_decision(answer: GroupDecisionResult["answers"][number]): DispatchBooleanDecision {
  const value = answer.value as boolean;
  return {
    value,
    ...(answer.probability !== undefined ? {
      probability: answer.probability,
      true_probability: value ? answer.probability : 1 - answer.probability,
    } : {}),
  };
}

/** 用户轮的两个因子必须都有有效置信度，不对缺失值补默认概率。 */
function read_factor_decision(answer: GroupDecisionResult["answers"][number]): DispatchFactorDecision {
  const decision = read_boolean_decision(answer);
  if (decision.probability === undefined || decision.true_probability === undefined) {
    throw new Error(`Missing Group factor probability: ${answer.question_id}`);
  }
  return { value: decision.value, probability: decision.probability, true_probability: decision.true_probability };
}
