/**
 * Group 调度策略：根据群聊语义与成员画像生成有限的阶段计划。
 *
 * 调度器只负责决定谁在什么阶段完成哪项工作，不接触 Agent 的执行能力、完整指令或
 * Session 生命周期。GroupSession 负责执行计划，并在需要时用真实结果发起下一轮判断。
 */

import type { GroupMessage } from "@/types/group/Group.js";
import type {
  ModelClient,
  ModelContent,
  ModelJsonValue,
  ModelMessage,
} from "@downcity/type";
import { generate_model } from "@/model/ModelGenerate.js";
import { z } from "zod";

/** 本次调度的触发来源。 */
export type DispatchTrigger = "user" | "auto";

/** 调度器理解当前 Group 所需的最小身份信息。 */
export interface DispatchGroupProfile {
  /** 当前 Group 的稳定标识。 */
  readonly group_id: string;
  /** 当前 Group 的用户可见名称。 */
  readonly name: string;
  /** 当前 Group 的可选协作目标，用于判断任务是否已经完成。 */
  readonly instruction?: string;
}

/** 调度器选择成员所需的最小 Agent 画像。 */
export interface DispatchMemberProfile {
  /** 当前成员 Agent 的稳定标识，也是调度协议引用该成员的键。 */
  readonly agent_id: string;
  /** 当前成员 Agent 的用户可见名称。 */
  readonly name: string;
  /** 当前成员 Agent 的能力描述，用于判断任务与成员是否匹配。 */
  readonly description: string;
}

/** 一个阶段中交给单个成员的独立任务。 */
export interface DispatchAssignment {
  /** 接收当前任务的成员 Agent 标识。 */
  readonly member_id: string;
  /** 当前成员在本阶段需要直接完成的具体任务。 */
  readonly instruction: string;
}

/** 调度计划中的一个顺序阶段；阶段内部的任务并行执行。 */
export interface DispatchStage {
  /** 当前计划内稳定、可持久化的阶段标识。 */
  readonly stage_id: string;
  /** 当前阶段需要并行执行的成员专属任务。 */
  readonly assignments: readonly DispatchAssignment[];
}

/** 一次调度生成的有限阶段计划。 */
export interface DispatchDecision {
  /** 调度器对成员选择、阶段安排和停止判断的简要说明。 */
  readonly reason: string;
  /** 按顺序执行的阶段；同一阶段内的任务并行执行。 */
  readonly stages: readonly DispatchStage[];
  /** 当前计划执行后是否已经可以结束，不再基于结果自动调度。 */
  readonly terminal: boolean;
}

/** Group 调度策略协议。 */
export interface DispatchStrategy {
  /** 根据触发来源、当前消息、历史、新增批次和成员画像生成当前最佳阶段计划。 */
  decide_dispatch(input: {
    /** 当前 Group 的只读语义画像。 */
    readonly group: DispatchGroupProfile;
    /** 本次调度由用户消息触发，还是由 GroupSession 自动收口触发。 */
    readonly trigger: DispatchTrigger;
    /** 当前待判断的 Group 消息；它在新增批次中以当前标记出现。 */
    readonly current_message: GroupMessage;
    /** 本批新增消息之前的最近 Group 对话，不包含 pending_messages。 */
    readonly history: readonly GroupMessage[];
    /** 当前调度尚未消费的新增 Group 消息批次。 */
    readonly pending_messages: readonly GroupMessage[];
    /** 当前 Group 成员的只读语义画像。 */
    readonly members: readonly DispatchMemberProfile[];
    /** 当前 GroupSession 调度 Turn 的取消信号。 */
    readonly abort_signal: AbortSignal;
  }): Promise<DispatchDecision> | DispatchDecision;
}

/** AI 调度策略的构造参数。 */
export interface AiDispatchStrategyOptions {
  /** Group 用于理解群聊意图并生成阶段计划的模型。 */
  readonly model?: ModelClient;
}

/** AI 调度工具的最小输入协议；阶段串行，阶段内 assignment 并行。 */
const dispatch_group_input_schema = z.object({
  /** 解释成员选择、阶段安排以及停止或继续的语义依据。 */
  reason: z.string().trim().min(1).max(2_000),
  /** 当前已经可以确定的有限工作阶段。 */
  stages: z.array(z.object({
    /** 当前阶段内可以独立并行的成员任务。 */
    assignments: z.array(z.object({
      /** 接收任务的真实成员 Agent 标识。 */
      member_id: z.string().trim().min(1),
      /** 该成员需要直接完成的具体任务。 */
      instruction: z.string().trim().min(1).max(4_000),
    })).min(1).max(16),
  })).max(16),
  /** 当前阶段执行完即可结束，还是必须依据实际结果再判断一次。 */
  next: z.enum(["stop", "continue"]),
});

const max_dispatch_model_steps = 3;

const dispatch_system_prompt = [
  "你是 Group 的语义调度器，只能调用一次 dispatch_group，不得直接回答用户问题。",
  "你的职责是用最少的必要成员和阶段满足用户意图，并在语义上已经完成时立即停止。",
  "请根据 Group 目标、成员名称和能力描述选择成员；只能选择给出的真实 member_id。",
  "普通任务默认只交给一个最匹配的成员。只有任务可独立并行，或用户明确要求多人分别回答时，才在同一阶段安排多个 assignment。",
  "每个 assignment 必须写成员专属、可以直接执行的具体任务，不能只写‘回复用户’或重复成员身份。",
  "stages 按顺序执行，同一 stage 内的 assignments 并行执行。已知的连续步骤应一次规划进多个 stages。",
  "next=continue 仅用于下一步选择必须依赖本轮成员的实际输出；它不是邀请更多成员继续讨论。",
  "若当前对话已经满足用户意图，返回 stages=[]、next=stop。若所列 stages 执行后即可满足意图，也使用 next=stop。",
  "不得因为尚有其他成员、礼貌附和、重复总结、非必要 review 或维持对话而继续。",
].join("\n");

/** 使用 Group.model 理解群聊意图并通过内部 tool call 生成阶段计划。 */
export class AiDispatchStrategy implements DispatchStrategy {
  private readonly model?: ModelClient;

  constructor(options: AiDispatchStrategyOptions = {}) {
    this.model = options.model;
  }

  async decide_dispatch(input: {
    readonly group: DispatchGroupProfile;
    readonly trigger: DispatchTrigger;
    readonly current_message: GroupMessage;
    readonly history: readonly GroupMessage[];
    readonly pending_messages: readonly GroupMessage[];
    readonly members: readonly DispatchMemberProfile[];
    readonly abort_signal: AbortSignal;
  }): Promise<DispatchDecision> {
    if (!this.model) {
      throw new Error("Group requires a configured model for dispatch");
    }
    try {
      const messages: ModelMessage[] = [
        { role: "system", content: [{ type: "text", text: dispatch_system_prompt }] },
        { role: "user", content: [{ type: "text", text: build_dispatch_prompt(input) }] },
      ];
      let protocol_error = "Group dispatch model did not call dispatch_group";
      for (let step_index = 0; step_index < max_dispatch_model_steps; step_index += 1) {
        const result = await generate_model(this.model, {
          messages,
          tools: [{
            name: "dispatch_group",
            description: "提交当前 Group 的有限阶段计划。已经完成时使用空 stages 和 next=stop；只有后续选择依赖实际结果时才使用 next=continue。",
            input_schema: z.toJSONSchema(dispatch_group_input_schema) as Record<string, ModelJsonValue>,
          }],
          tool_choice: { type: "tool", tool_name: "dispatch_group" },
          max_output_tokens: 1_200,
          reasoning: { enabled: false },
        }, {
          request_kind: "group_dispatch",
          signal: input.abort_signal,
        });
        const dispatch_call = result.tool_calls.length === 1 && result.tool_calls[0]?.tool_name === "dispatch_group"
          ? result.tool_calls[0]
          : undefined;
        if (dispatch_call) {
          try {
            return normalize_dispatch_tool_input(dispatch_call.input, input.members);
          } catch (error) {
            protocol_error = error instanceof Error ? error.message : String(error);
          }
        } else {
          protocol_error = "Group dispatch model did not call dispatch_group exactly once";
        }
        if (step_index + 1 >= max_dispatch_model_steps) break;
        append_dispatch_retry_messages(messages, result.text, result.tool_calls, protocol_error);
      }
      throw new Error(`${protocol_error} after ${max_dispatch_model_steps} attempts`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Group dispatch model failed: ${detail}`, { cause: error });
    }
  }
}

/** 把协议错误作为下一模型 step 的显式上下文，允许模型在同一调度 Turn 内纠正。 */
function append_dispatch_retry_messages(
  messages: ModelMessage[],
  text: string,
  tool_calls: readonly { type: "tool_call"; tool_call_id: string; tool_name: string; input: ModelJsonValue }[],
  error: string,
): void {
  const assistant_content: ModelContent[] = [
    ...(text.trim() ? [{ type: "text" as const, text }] : []),
    ...tool_calls,
  ];
  if (assistant_content.length > 0) {
    messages.push({ role: "assistant", content: assistant_content });
  }
  if (tool_calls.length > 0) {
    messages.push({
      role: "tool",
      content: tool_calls.map((tool_call) => ({
        type: "tool_result" as const,
        tool_call_id: tool_call.tool_call_id,
        tool_name: tool_call.tool_name,
        outcome: "failed" as const,
        content: [{ type: "text" as const, text: error }],
      })),
    });
  }
  messages.push({
    role: "user",
    content: [{
      type: "text",
      text: `上一响应不符合调度协议：${error}。请只调用一次 dispatch_group。`,
    }],
  });
}

/** 为 AI 调度器构造稳定、有限且不重复当前消息的群聊上下文。 */
function build_dispatch_prompt(input: {
  readonly group: DispatchGroupProfile;
  readonly trigger: DispatchTrigger;
  readonly current_message: GroupMessage;
  readonly history: readonly GroupMessage[];
  readonly pending_messages: readonly GroupMessage[];
  readonly members: readonly DispatchMemberProfile[];
}): string {
  const members = input.members.map((member) => [
    `- ID: ${member.agent_id}`,
    `  名称: ${member.name}`,
    `  能力描述: ${member.description || "（未提供）"}`,
  ].join("\n")).join("\n");
  const history = input.history.slice(-20).map(format_group_message).join("\n");
  const pending_messages = input.pending_messages.map((message) => (
    `${message.id === input.current_message.id ? "[当前] " : ""}${format_group_message(message)}`
  )).join("\n");
  return [
    "Group:",
    `- ID: ${input.group.group_id}`,
    `- 名称: ${input.group.name}`,
    `- 目标: ${input.group.instruction || "（未提供）"}`,
    "成员:",
    members,
    "此前对话:",
    history || "（无）",
    "本批新增消息:",
    pending_messages || "（无）",
    `触发方式: ${input.trigger}`,
    "请调用 dispatch_group，提交 reason、stages 和 next，不要输出普通文本。",
  ].join("\n");
}

/** 将 GroupMessage 格式化为调度器可读、稳定的单行文本。 */
function format_group_message(message: GroupMessage): string {
  return `${message.sender_type}:${message.sender_id}: ${message.text}`;
}

/** 将 AI tool call 校验并编译为内部阶段计划。 */
function normalize_dispatch_tool_input(
  value: unknown,
  members: readonly DispatchMemberProfile[],
): DispatchDecision {
  const parsed = dispatch_group_input_schema.parse(value);
  const valid_ids = new Set(members.map((member) => member.agent_id));
  const stages = parsed.stages.map((stage, stage_index) => {
    const selected_member_ids = new Set<string>();
    const assignments = stage.assignments.map((assignment) => {
      if (!valid_ids.has(assignment.member_id)) {
        throw new Error(`Group dispatch selected unknown member: ${assignment.member_id}`);
      }
      if (selected_member_ids.has(assignment.member_id)) {
        throw new Error(`Group dispatch selected member more than once in stage ${stage_index}`);
      }
      selected_member_ids.add(assignment.member_id);
      return {
        member_id: assignment.member_id,
        instruction: assignment.instruction,
      };
    });
    return {
      stage_id: `stage-${stage_index}`,
      assignments,
    };
  });
  if (stages.length === 0 && parsed.next === "continue") {
    throw new Error("Group dispatch cannot continue without any stage");
  }
  return {
    reason: parsed.reason,
    stages,
    terminal: parsed.next === "stop",
  };
}
