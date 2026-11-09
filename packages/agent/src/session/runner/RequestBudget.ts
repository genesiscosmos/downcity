/**
 * 最终请求预算与有界主动推进。输入是冻结 system、动态摘要、消息及已绑定工具的最终视图。
 * 只重新组装模型输入并推进 checkpoint，不执行任何工具；估算不冒充 Provider usage。
 */
import { build_model_step_call } from "@/model/ModelStepCall.js";
import { estimate_context_tokens } from "@/session/input/composer/ContextTokenBudget.js";
import type { SessionStepExecutionInput } from "@/types/session/SessionExecution.js";

/** 协议及估算误差的最低预留。 */
export const REQUEST_SAFETY_TOKENS = 2048;
/** 每次模型请求前最多推进的次数；即使 Composer 一直返回 true 也会结束。 */
export const MAX_PREFLIGHT_ADVANCES = 8;

/** 使用与实际发送完全相同的请求装配结果计算估算值与固定开销。 */
export function measure_request(input: SessionStepExecutionInput) {
  const call = build_model_step_call(input.system, input.messages, input.tools);
  const window = input.context_window ?? input.model.context_window;
  const system = call.messages.filter(message => message.role === "system");
  const estimated_input_tokens = estimate_context_tokens(JSON.stringify(call)) + call.messages.length * 16;
  const fixed_tokens = estimate_context_tokens(JSON.stringify({ messages: system, tools: call.tools })) + system.length * 16;
  const output_tokens = call.max_output_tokens!;
  const safety_tokens = Math.max(REQUEST_SAFETY_TOKENS, Math.ceil((window ?? 0) * 0.05));
  const input_budget = window && window > 0 ? window - output_tokens - safety_tokens : null;
  let largest_tool_result_bytes = 0;
  let largest_uncompressible_tokens = 0;
  for (const message of input.messages) {
    for (const part of message.content) {
      if (part.type === "tool_result") largest_tool_result_bytes = Math.max(largest_tool_result_bytes, Buffer.byteLength(JSON.stringify(part.content)));
      if (part.type === "tool_call") largest_uncompressible_tokens = Math.max(largest_uncompressible_tokens, estimate_context_tokens(JSON.stringify(part.input)));
    }
    if (message.role === "user") largest_uncompressible_tokens = Math.max(largest_uncompressible_tokens, estimate_context_tokens(JSON.stringify(message)));
  }
  return { estimated_input_tokens, fixed_tokens, input_budget, output_tokens, safety_tokens,
    context_window: window ?? null, request_bytes: Buffer.byteLength(JSON.stringify(call)), largest_tool_result_bytes,
    largest_uncompressible_tokens };
}

/** 发送前迭代压缩并检测进展；固定输入、缺失窗口、无法缩小均返回有定位信息的终态。 */
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
    const step = await input.resolve();
    const diagnostic = measure_request(step);
    await input.report({ ...diagnostic, advance_count });
    const { input_budget, estimated_input_tokens, fixed_tokens, largest_uncompressible_tokens } = diagnostic;
    if (input_budget === null) throw new Error(`Model context window metadata is required for request budgeting (model_id=${step.model.id}, estimated_input_tokens=${estimated_input_tokens})`);
    if (fixed_tokens >= input_budget) throw new Error(`Fixed system/tools exceed model input budget (fixed_tokens=${fixed_tokens}, input_budget=${input_budget})`);
    if (largest_uncompressible_tokens > input_budget - fixed_tokens) throw new Error(`A user message or tool input exceeds model input budget; reduce that input (estimated_tokens=${largest_uncompressible_tokens}, available_tokens=${input_budget - fixed_tokens})`);
    if (estimated_input_tokens <= input_budget) return step;
    if (estimated_input_tokens >= previous_tokens) throw new Error(`Context compaction made no request-budget progress (estimated_input_tokens=${estimated_input_tokens}, input_budget=${input_budget})`);
    if (advance_count === MAX_PREFLIGHT_ADVANCES) throw new Error(`Request-budget compaction limit reached (estimated_input_tokens=${estimated_input_tokens}, input_budget=${input_budget})`);
    previous_tokens = estimated_input_tokens;
    input.signal.throwIfAborted();
    if (!await input.advance()) throw new Error(`Model request exceeds input budget with no stable history to compact (estimated_input_tokens=${estimated_input_tokens}, input_budget=${input_budget})`);
  }
  throw new Error("Request budgeting did not reach a terminal state");
}
