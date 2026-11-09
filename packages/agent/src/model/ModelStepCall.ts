/**
 * 最终模型请求的唯一装配边界，供发送和请求前预算共同使用。
 * 固定输出上限使预算包含实际计划输出；工具 Schema 与 system 都按真实发送格式估算。
 */
import { z } from "zod";
import type { ModelCall, ModelJsonValue, SessionSystemMessage } from "@downcity/type";
import type { BoundAgentTool } from "@/types/tool/BoundAgentTool.js";
import type { ModelMessage } from "@downcity/type";

/** 正常 Step 为输出预留的 token 上限。 */
export const STEP_MAX_OUTPUT_TOKENS = 8192;

/** 构造执行和预算共用的最终请求，不读取或修改 canonical 历史。 */
export function build_model_step_call(system: SessionSystemMessage[], messages: ModelMessage[], tools: Record<string, BoundAgentTool>): ModelCall {
  return {
    messages: [...system.map(message => ({ role: "system" as const,
      content: [{ type: "text" as const, text: typeof message === "string" ? message : String(message.content ?? "") }] })), ...messages],
    tools: Object.entries(tools).map(([name, tool]) => ({
      name, description: tool.description ?? "", input_schema: read_input_schema(tool.input_schema),
    })),
    max_output_tokens: STEP_MAX_OUTPUT_TOKENS,
  };
}

/** 将工具当前的 JSON Schema 或 Zod Schema 收敛为协议 JSON Schema。 */
function read_input_schema(value: unknown): Record<string, ModelJsonValue> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  if (record.jsonSchema && typeof record.jsonSchema === "object") return record.jsonSchema as Record<string, ModelJsonValue>;
  try { return z.toJSONSchema(value as z.ZodType) as Record<string, ModelJsonValue>; }
  catch { return record as Record<string, ModelJsonValue>; }
}
