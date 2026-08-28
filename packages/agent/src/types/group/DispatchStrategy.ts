/** Group 调度策略：为当前消息上下文生成一组有依赖关系的成员投递节点。 */

import type { GroupMessage } from "@/types/group/Group.js";
import type { Agent } from "@/agent/Agent.js";
import type { AgentModel } from "@/agent/AgentModel.js";
import { generateText, stepCountIs, tool, type LanguageModel } from "ai";
import { z } from "zod";

/** 一个投递节点内成员的发言方式。 */
export type DispatchResponseMode = "single" | "parallel";

/** 本次调度的触发来源。 */
export type DispatchTrigger = "user" | "auto";

/** 调度图中的一个成员投递节点。 */
export interface DispatchNode {
  /** 当前调度图内的稳定节点标识。 */
  readonly node_id: string;
  /** 当前节点允许接收消息的成员标识。 */
  readonly member_ids: readonly string[];
  /** 当前节点只运行首个成员，还是允许全部成员并行运行。 */
  readonly response_mode: DispatchResponseMode;
  /** 当前节点依赖的前置节点标识；依赖完成后才能投递。 */
  readonly depends_on_node_ids: readonly string[];
  /** 注入成员 AgentSession 的发言约束。 */
  readonly instruction: string;
}

/** 一次调度生成的当前最佳响应图。 */
export interface DispatchDecision {
  /** 当前调度图中的投递节点。 */
  readonly nodes: readonly DispatchNode[];
  /** 当前图完成后是否允许唯一的 GroupSession auto dispatch 继续判断。 */
  readonly terminal: boolean;
}

/** Group 调度策略协议。 */
export interface DispatchStrategy {
  /** 根据触发来源、当前消息、历史和成员关系生成当前最佳响应图。 */
  decide_dispatch(input: {
    /** 本次调度由用户消息触发，还是由 GroupSession 自动收口触发。 */
    readonly trigger: DispatchTrigger;
    /** 当前待调度的 Group 消息；auto dispatch 时为本批新增消息中的最后一条。 */
    readonly message: GroupMessage;
    /** 当前 auto dispatch 尚未消费的新增消息。 */
    readonly pending_messages: readonly GroupMessage[];
    /** 当前 Group 已存在的消息历史。 */
    readonly messages: readonly GroupMessage[];
    /** 当前 Group 成员快照。 */
    readonly members: readonly Agent[];
  }): Promise<DispatchDecision> | DispatchDecision;
}

/** AI 调度策略的构造参数。 */
export interface AiDispatchStrategyOptions {
  /** Group 用于理解群聊意图并生成调度图的模型。 */
  readonly model?: AgentModel;
}

/** AI 调度工具的最小输入协议；外层阶段串行，阶段内成员并行。 */
const dispatch_group_input_schema = z.object({
  steps: z.array(z.array(z.string().trim().min(1)).min(1).max(16)).max(16),
  /** 当前响应图完成后是否交给唯一的 auto dispatch 继续判断。 */
  next: z.enum(["stop", "continue"]),
});

/** 内部调度工具只回显参数，不执行任何成员或业务操作。 */
const dispatch_group_tool = tool({
  description: "提交当前 Group 的成员投递路径。只调用一次；不要输出普通文本。没有成员需要回复时使用空 steps 和 next=stop。",
  inputSchema: dispatch_group_input_schema,
  execute: async (input) => ({ accepted: true, ...input }),
});

/** 使用 Group.model 理解群聊意图并通过内部 tool call 生成成员投递决定。 */
export class AiDispatchStrategy implements DispatchStrategy {
  private readonly model?: LanguageModel;

  constructor(options: AiDispatchStrategyOptions = {}) {
    this.model = options.model;
  }

  async decide_dispatch(input: {
    readonly trigger: DispatchTrigger;
    readonly message: GroupMessage;
    readonly pending_messages: readonly GroupMessage[];
    readonly messages: readonly GroupMessage[];
    readonly members: readonly Agent[];
  }): Promise<DispatchDecision> {
    if (!this.model) {
      throw new Error("Group requires a configured model for dispatch");
    }
    try {
      const result = await generateText({
        model: this.model,
        tools: { dispatch_group: dispatch_group_tool },
        toolChoice: { type: "tool", toolName: "dispatch_group" },
        stopWhen: stepCountIs(1),
        system: "你是群聊消息调度器。你只能调用 dispatch_group，不回答用户问题。普通任务默认只选择一个最合适的成员；只有用户明确要求多人分别回答，或确实存在并行的独立工作时，才把多个成员放在同一阶段。外层 steps 阶段按顺序执行，后一个阶段等待前一个阶段完成。只有真实存在的成员才能被选择。",
        prompt: build_dispatch_prompt(input),
        maxOutputTokens: 600,
        providerOptions: {
          downcity: {
            reasoning: false,
          },
        },
      });
      if (result.toolCalls.length !== 1 || result.toolCalls[0]?.toolName !== "dispatch_group") {
        throw new Error("Group dispatch model did not call dispatch_group");
      }
      return normalize_dispatch_tool_input(result.toolCalls[0].input, input.members);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Group dispatch model failed: ${detail}`, { cause: error });
    }
  }
}

/** 为 AI 调度器构造稳定、有限长度的群聊上下文。 */
function build_dispatch_prompt(input: {
  readonly trigger: DispatchTrigger;
  readonly message: GroupMessage;
  readonly pending_messages: readonly GroupMessage[];
  readonly messages: readonly GroupMessage[];
  readonly members: readonly Agent[];
}): string {
  const members = input.members.map((member) => `- ${member.id}`).join("\n");
  const history = input.messages.slice(-20).map((message) => `${message.sender_type}:${message.sender_id}: ${message.text}`).join("\n");
  return [
    "成员：",
    members,
    "最近群聊：",
    history || "（无）",
    "本次新增消息：",
    input.pending_messages.map((message) => `${message.sender_type}:${message.sender_id}: ${message.text}`).join("\n") || "（无）",
    `调度触发来源：${input.trigger}`,
    "当前消息：",
    `${input.message.sender_type}:${input.message.sender_id}: ${input.message.text}`,
    "请调用 dispatch_group，输入 steps 和 next。steps 是二维数组：外层阶段按顺序执行，同一阶段数组内的成员并行执行；没有成员需要回复时使用空 steps 和 next=stop。不要输出普通文本。",
  ].join("\n");
}

/** 将 AI tool call 编译为内部执行图，并确保只引用真实成员。 */
function normalize_dispatch_tool_input(value: unknown, members: readonly Agent[]): DispatchDecision {
  const parsed = dispatch_group_input_schema.parse(value);
  const valid_ids = new Set(members.map((member) => member.id));
  const nodes = parsed.steps.map((member_ids, index) => {
    const unique_member_ids = [...new Set(member_ids)];
    if (unique_member_ids.length !== member_ids.length) {
      throw new Error(`Group dispatch selected member more than once in step ${index}`);
    }
    for (const member_id of unique_member_ids) {
      if (!valid_ids.has(member_id)) {
        throw new Error(`Group dispatch selected unknown member: ${member_id}`);
      }
    }
    return {
      node_id: `step-${index}`,
      member_ids: unique_member_ids,
      response_mode: unique_member_ids.length > 1 ? "parallel" as const : "single" as const,
      depends_on_node_ids: index === 0 ? [] : [`step-${index - 1}`],
      instruction: "根据当前 Group 上下文判断是否需要回复，只代表自己发言；不需要时返回空内容。",
    };
  });
  if (nodes.length === 0 && parsed.next === "continue") {
    throw new Error("Group dispatch cannot continue without any member step");
  }
  return {
    nodes,
    terminal: parsed.next === "stop",
  };
}
