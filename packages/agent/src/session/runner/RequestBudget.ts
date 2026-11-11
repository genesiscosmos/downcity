/**
 * 最终请求预算与有界主动推进。输入是冻结 system、动态摘要、消息及已绑定工具的最终视图。
 * 只重新组装模型输入并推进 checkpoint，不执行任何工具；估算不冒充 Provider usage。
 */
import { omit_oldest_automatic_image } from "@/model/messages/AutomaticImageBudget.js";
import { build_model_step_call } from "@/model/ModelStepCall.js";
import { estimate_request_tokens, estimate_message_tokens, estimate_content_tokens } from "./RequestTokenEstimate.js";
import { estimate_context_tokens } from "@/session/input/composer/ContextTokenBudget.js";
import type { SessionStepExecutionInput } from "@/types/session/SessionExecution.js";

/** 协议及估算误差的最低预留。 */
export const REQUEST_SAFETY_TOKENS = 2048;
/** 每次模型请求前最多推进的次数；即使 Composer 一直返回 true 也会结束。 */
export const MAX_PREFLIGHT_ADVANCES = 8;

/** 最大消息或内容片段的规模与位置；仅含元信息，不含正文、参数或媒体数据。 */
type RequestBudgetItem = {
  /** 输入项类别，例如 user_message、assistant_text、tool_input 或 tool_result。 */
  category: string;
  /** 在当前派生 input.messages 中的位置，从 1 开始，不包含单独传入的 system。 */
  message_index: number;
  /** 消息角色，用于区分当前输入与 assistant、tool 等历史消息。 */
  role: SessionStepExecutionInput["messages"][number]["role"];
  /** 内容片段在 message.content 中的位置，从 1 开始；整条消息为 null。 */
  part_index: number | null;
  /** 工具输入或结果所属的工具名；普通消息为 null。 */
  tool_name: string | null;
  /** 工具输入或结果对应的调用 ID；普通消息为 null。 */
  tool_call_id: string | null;
  /** 对该消息或片段序列化后进行保守估算所得的 token 数。 */
  estimated_tokens: number;
};

/** 使用与实际发送完全相同的请求装配结果计算估算值与固定开销。 */
export function measure_request(input: SessionStepExecutionInput) {
  const call = build_model_step_call(input.system, input.messages, input.tools);
  const window = input.context_window ?? input.model.context_window;
  const system = call.messages.filter(message => message.role === "system");
  const serialized_call = JSON.stringify(call);
  const token_estimate = estimate_request_tokens(call);
  const estimated_input_tokens = token_estimate.text_estimated_tokens + token_estimate.image_estimated_tokens;
  const fixed_tokens = estimate_context_tokens(JSON.stringify({ messages: system, tools: call.tools })) + system.length * 16;
  const output_tokens = call.max_output_tokens!;
  const safety_tokens = Math.max(REQUEST_SAFETY_TOKENS, Math.ceil((window ?? 0) * 0.05));
  const input_budget = window && window > 0 ? window - output_tokens - safety_tokens : null;
  let largest_tool_result_bytes = 0;
  // 图片按视觉启发式预留，编码大小单独记录；其它媒体仍按原文本估算处理。
  let largest_item: RequestBudgetItem | null = null;
  for (const [message_offset, message] of input.messages.entries()) {
    const has_tool_parts = message.content.some(part => part.type === "tool_call" || part.type === "tool_result");
    const message_item: RequestBudgetItem = {
      category: `${message.role}_message`, message_index: message_offset + 1, role: message.role,
      part_index: null, tool_name: null, tool_call_id: null,
      estimated_tokens: has_tool_parts ? 0 : estimate_message_tokens(message),
    };
    if (!has_tool_parts && (!largest_item || message_item.estimated_tokens > largest_item.estimated_tokens)) largest_item = message_item;
    for (const [part_offset, part] of message.content.entries()) {
      const is_tool = part.type === "tool_call" || part.type === "tool_result";
      if (has_tool_parts) {
        const part_item: RequestBudgetItem = {
          ...message_item, category: part.type === "tool_call" ? "tool_input" : part.type === "tool_result" ? "tool_result" : `${message.role}_${part.type}`,
          part_index: part_offset + 1, tool_name: is_tool ? part.tool_name : null,
          tool_call_id: is_tool ? part.tool_call_id : null,
          estimated_tokens: estimate_content_tokens(part),
        };
        if (!largest_item || part_item.estimated_tokens > largest_item.estimated_tokens) largest_item = part_item;
      }
      if (part.type === "tool_result") largest_tool_result_bytes = Math.max(largest_tool_result_bytes, Buffer.byteLength(JSON.stringify(part.content)));
    }
  }
  return { estimated_input_tokens, fixed_tokens, input_budget, output_tokens, safety_tokens,
    context_window: window ?? null, request_bytes: Buffer.byteLength(serialized_call), largest_tool_result_bytes,
    ...token_estimate, largest_item };
}

/** 生成超限终态；最大输入仅用于定位，不据此推断历史能否摘要。 */
function request_budget_error(reason: string, diagnostic: ReturnType<typeof measure_request>): Error {
  const { estimated_input_tokens, fixed_tokens, input_budget, largest_item } = diagnostic;
  const available_tokens = input_budget === null ? null : input_budget - fixed_tokens;
  const category = available_tokens !== null && available_tokens <= 0 ? "fixed_system_tools"
    : largest_item && available_tokens !== null && largest_item.estimated_tokens > available_tokens ? "single_input" : "total_request";
  return new Error(`Model request exceeds input budget: ${reason} (category=${category}, estimated_input_tokens=${estimated_input_tokens}, input_budget=${input_budget}, fixed_tokens=${fixed_tokens}, available_tokens=${available_tokens}, largest_item=${JSON.stringify(largest_item)})`);
}

/** 发送前先推进稳定历史再重新测量；固定开销不足、缺失窗口或有界推进失败均终止。 */
export async function fit_request(input: {
  /** 每次推进后重新读取派生 checkpoint 并组装最终输入。 */
  resolve: () => Promise<SessionStepExecutionInput>;
  /** 通过 Session 既有动作生命周期推进稳定历史。 */
  advance: () => Promise<boolean>;
  /** 当前 Turn 的取消信号，取消后不能继续摘要或发送。 */
  signal: AbortSignal;
  /** 只输出规模元信息的诊断回调。 */
  report: (diagnostic: ReturnType<typeof measure_request> & { /** 当前请求前推进次数。 */ advance_count: number }) => Promise<void>;
}): Promise<SessionStepExecutionInput> {
  let previous_tokens = Infinity;
  for (let advance_count = 0; advance_count <= MAX_PREFLIGHT_ADVANCES; advance_count++) {
    input.signal.throwIfAborted();
    let step = await input.resolve();
    input.signal.throwIfAborted();
    let diagnostic = measure_request(step);
    // 可选图片先退为引用，再考虑历史摘要；避免自动图片使普通对话无法继续。
    while (diagnostic.input_budget !== null && diagnostic.estimated_input_tokens > diagnostic.input_budget) {
      input.signal.throwIfAborted();
      const messages = omit_oldest_automatic_image(step.messages);
      if (!messages) break;
      step = { ...step, messages };
      diagnostic = measure_request(step);
    }
    await input.report({ ...diagnostic, advance_count });
    input.signal.throwIfAborted();
    const { input_budget, estimated_input_tokens, fixed_tokens } = diagnostic;
    if (input_budget === null) throw new Error(`Model context window metadata is required for request budgeting (model_id=${step.model.id}, estimated_input_tokens=${estimated_input_tokens})`);
    if (fixed_tokens >= input_budget) throw request_budget_error("fixed system/tools exhaust the input budget", diagnostic);
    if (estimated_input_tokens <= input_budget) return step;
    if (estimated_input_tokens >= previous_tokens) throw request_budget_error("context compaction made no request-budget progress", diagnostic);
    if (advance_count === MAX_PREFLIGHT_ADVANCES) throw request_budget_error("request-budget compaction limit reached", diagnostic);
    previous_tokens = estimated_input_tokens;
    input.signal.throwIfAborted();
    const advanced = await input.advance();
    input.signal.throwIfAborted();
    if (!advanced) throw request_budget_error("no stable history to compact", diagnostic);
  }
  throw new Error("Request budgeting did not reach a terminal state");
}
