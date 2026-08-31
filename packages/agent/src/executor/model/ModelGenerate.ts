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
import { ModelStreamValidator } from "@downcity/type";

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

/** 执行一次不包含 Agent 工具循环的模型调用。 */
export async function generate_model(
  model: ModelClient,
  call: ModelCall,
  signal?: AbortSignal,
): Promise<ModelGenerateResult> {
  const stream = await model.stream(call, signal);
  const text_by_id = new Map<string, string>();
  const tools = new Map<string, { tool_call_id: string; tool_name: string }>();
  const tool_calls: ModelToolCallContent[] = [];
  let text = "";
  let finish_reason: ModelFinishReason | undefined;
  let usage: ModelUsage | undefined;
  const validator = new ModelStreamValidator();
  for await (const event of stream) {
    validator.accept(event);
    if (event.type === "model_error") throw new Error(event.error.message);
    if (event.type === "text_start") text_by_id.set(event.content_id, "");
    else if (event.type === "text_delta") {
      text_by_id.set(event.content_id, (text_by_id.get(event.content_id) ?? "") + event.delta);
      text += event.delta;
    } else if (event.type === "tool_call_start") {
      tools.set(event.content_id, { tool_call_id: event.tool_call_id, tool_name: event.tool_name });
    } else if (event.type === "tool_call_finish") {
      const tool = tools.get(event.content_id);
      if (tool) tool_calls.push({ type: "tool_call", ...tool, input: event.input });
    } else if (event.type === "model_usage") usage = event.usage;
    else if (event.type === "model_finish") finish_reason = event.finish_reason;
  }
  validator.finish();
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
