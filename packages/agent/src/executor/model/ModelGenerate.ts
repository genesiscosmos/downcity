/**
 * Downcity ModelClient 非交互生成辅助模块。
 *
 * 标题、压缩和调度等旁路复用同一标准协议，不建立第二套模型运行时。
 */

import type {
  ModelCall,
  ModelClient,
  ModelFinishReason,
  ModelMessage,
  ModelToolCallContent,
  ModelUsage,
} from "@downcity/type";
import { execute_model_request } from "@executor/model/ModelRequestRunner.js";
import { consume_model_stream } from "@executor/model/ModelStreamConsumer.js";
import type {
  ModelRequestFailureReporter,
  ModelRequestKind,
} from "@/types/executor/ModelRequest.js";

/** 单次非交互模型生成结果。 */
export interface ModelGenerateResult {
  /** 聚合后的普通文本。 */
  text: string;
  /** 聚合后的工具调用。 */
  tool_calls: ModelToolCallContent[];
  /** 标准完成原因。 */
  finish_reason: ModelFinishReason;
  /** Provider 返回的可选 usage。 */
  usage?: ModelUsage;
}

/** 非交互模型生成执行选项。 */
export interface ModelGenerateOptions {
  /** 当前模型请求用途。 */
  request_kind: Exclude<ModelRequestKind, "turn">;
  /** 可选取消信号。 */
  signal?: AbortSignal;
  /** 可选逐次失败通知入口。 */
  on_failure?: ModelRequestFailureReporter;
}

/** 执行一次不包含 Agent 工具循环的模型调用。 */
export async function generate_model(
  model: ModelClient,
  call: ModelCall,
  options: ModelGenerateOptions,
): Promise<ModelGenerateResult> {
  return await execute_model_request({
    request_kind: options.request_kind,
    abort_signal: options.signal,
    on_failure: options.on_failure,
    execute_attempt: async () =>
      await generate_model_once(model, call, options.signal),
  });
}

/** 执行一次非交互模型调用并聚合完整结果。 */
async function generate_model_once(
  model: ModelClient,
  call: ModelCall,
  signal?: AbortSignal,
): Promise<ModelGenerateResult> {
  const tools = new Map<string, { tool_call_id: string; tool_name: string }>();
  const tool_calls: ModelToolCallContent[] = [];
  let text = "";
  let has_partial_output = false;
  let finish_reason: ModelFinishReason | undefined;
  let usage: ModelUsage | undefined;
  await consume_model_stream(
    model,
    call,
    signal,
    () => has_partial_output,
    (event) => {
      if (
        event.type === "text_delta" ||
        event.type === "reasoning_start" ||
        event.type === "reasoning_delta" ||
        event.type === "tool_call_start" ||
        event.type === "tool_call_delta"
      ) {
        has_partial_output = true;
      }
      if (event.type === "text_delta") {
        text += event.delta;
      } else if (event.type === "tool_call_start") {
        tools.set(event.content_id, { tool_call_id: event.tool_call_id, tool_name: event.tool_name });
      } else if (event.type === "tool_call_finish") {
        const tool = tools.get(event.content_id);
        if (tool && !event.input_error) {
          tool_calls.push({ type: "tool_call", ...tool, input: event.input });
        }
      } else if (event.type === "model_usage") usage = event.usage;
      else if (event.type === "model_finish") finish_reason = event.finish_reason;
    },
  );
  if (!finish_reason) throw new Error("Model stream ended without model_finish");
  return { text, tool_calls, finish_reason, ...(usage ? { usage } : {}) };
}

/** 构造单轮 system + user 文本消息。 */
export function build_text_model_messages(system: string, prompt: string): ModelMessage[] {
  return [
    ...(system.trim()
      ? [{ role: "system", content: [{ type: "text", text: system }] } as ModelMessage]
      : []),
    { role: "user", content: [{ type: "text", text: prompt }] },
  ];
}
