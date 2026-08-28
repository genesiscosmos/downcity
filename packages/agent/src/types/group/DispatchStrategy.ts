/** Group 调度策略：为当前消息上下文生成一组有依赖关系的成员投递节点。 */

import type { GroupMessage } from "@/types/group/Group.js";
import type { Agent } from "@/agent/Agent.js";
import type { AgentModel } from "@/agent/AgentModel.js";
import { generateObject, type LanguageModel } from "ai";
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

const dispatch_decision_schema = z.object({
  nodes: z.array(z.object({
    node_id: z.string(),
    member_ids: z.array(z.string()),
    response_mode: z.enum(["single", "parallel"]),
    depends_on_node_ids: z.array(z.string()),
    instruction: z.string(),
  })),
  terminal: z.boolean(),
});

/** 使用 Group.model 理解群聊意图并生成成员投递决定。 */
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
      const result = await generateObject({
        model: this.model,
        schema: dispatch_decision_schema,
        system: "你是群聊消息调度器。你只生成当前最佳响应图，不回答用户问题。普通任务默认只选择一个最合适的成员；只有用户明确要求多人分别回答，或确实存在并行的独立工作时，才允许多个节点或 parallel。节点之间可以声明依赖；依赖未完成时不能执行。只有真实存在的成员才能被选择。",
        prompt: build_dispatch_prompt(input),
        maxOutputTokens: 600,
      });
      return normalize_dispatch_decision(result.object, input.members);
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
    "请输出 JSON：nodes（node_id、member_ids、response_mode、depends_on_node_ids、instruction）和 terminal。",
  ].join("\n");
}

/** 过滤 AI 输出，确保调度结果只引用当前 Group 的真实成员。 */
function normalize_dispatch_decision(value: unknown, members: readonly Agent[]): DispatchDecision {
  const parsed = dispatch_decision_schema.parse(value);
  const valid_ids = new Set(members.map((member) => member.id));
  const valid_node_ids = new Set<string>();
  const nodes = parsed.nodes.map((node, index) => {
    const node_id = node.node_id.trim() || `node-${index + 1}`;
    const unique_node_id = valid_node_ids.has(node_id) ? `${node_id}-${index + 1}` : node_id;
    valid_node_ids.add(unique_node_id);
    const member_ids = [...new Set(node.member_ids.filter((member_id) => valid_ids.has(member_id)))];
    const depends_on_node_ids = [...new Set(node.depends_on_node_ids.filter((node_id) => node_id !== unique_node_id))];
    return {
      node_id: unique_node_id,
      member_ids: node.response_mode === "single" ? member_ids.slice(0, 1) : member_ids,
      response_mode: node.response_mode,
      depends_on_node_ids,
      instruction: node.instruction.trim() || "根据自己的能力判断是否需要回复；不需要时返回空内容。",
    };
  }).filter((node) => node.member_ids.length > 0);
  return {
    nodes,
    terminal: parsed.terminal,
  };
}
