/**
 * Downcity 模型 Step 执行模块。
 *
 * 模块直接消费 `ModelStreamEvent`、生成 canonical Assistant Parts，并执行本 Step 的工具调用。
 * 标准事件会原样交给 Session 输出端口，不产生 UI-shaped 中间事件。
 */

import {
  type ModelCall,
  type ModelClient,
  type ModelFinishReason,
  type ModelJsonValue,
  type ModelMessage,
  type ModelStreamEvent,
  type ModelTool,
  type ModelUsage,
} from "@downcity/type";
import type { BoundAgentTool, ToolCallSite } from "@/types/tool/BoundAgentTool.js";
import { z } from "zod";
import type { SessionSystemMessage } from "@downcity/type";
import type { SessionAssistantOutput } from "@/types/turn/SessionAssistantOutput.js";
import type {
  SessionAgentMessagePart,
  SessionAgentToolPart,
} from "@downcity/type";
import { consume_model_stream, type ModelStreamDiagnostic } from "@/model/ModelStreamConsumer.js";
import { validate_tool_input } from "@/model/ToolInputValidation.js";

/** 单个工具调用的执行事实。 */
export interface ModelStepToolCall {
  /** 工具调用 ID。 */
  tool_call_id: string;
  /** 工具名称。 */
  tool_name: string;
  /** 已解析工具输入。 */
  input: ModelJsonValue;
  /** 模型生成的工具输入无法解析时记录的错误。 */
  input_error?: string;
}

/** 单个工具结果的执行事实。 */
export interface ModelStepToolResult extends ModelStepToolCall {
  /** 工具执行是否成功。 */
  success: boolean;
  /** 工具返回或错误信息。 */
  output: unknown;
}

/** Agent 内部单个模型 Step 的稳定结果。 */
export interface ModelStepResult {
  /** 聚合后的普通文本。 */
  text: string;
  /** 标准完成原因。 */
  finish_reason: ModelFinishReason;
  /** Provider 返回的累计 usage。 */
  usage?: ModelUsage;
  /** 当前 Step 的工具调用。 */
  tool_calls: ModelStepToolCall[];
  /** 当前 Step 的工具结果。 */
  tool_results: ModelStepToolResult[];
  /** 供诊断代码读取的内容事实。 */
  content: Array<Record<string, unknown>>;
}

/** 执行一个模型 Step 的输入。 */
export interface RunModelStepInput {
  /** 当前 Step 的模型客户端。 */
  model: ModelClient;
  /** 当前 System 消息。 */
  system: SessionSystemMessage[];
  /** 当前模型上下文。 */
  messages: ModelMessage[];
  /** 当前可用工具运行时；上下文已在包装层绑定。 */
  tools: Record<string, BoundAgentTool>;
  /** 当前取消信号。 */
  abort_signal: AbortSignal;
  /** canonical Assistant 输出端口。 */
  assistant_output?: SessionAssistantOutput;
  /** 可选模型流阶段诊断；只传递时序和事件类型，不包含请求正文。 */
  on_diagnostic?: (diagnostic: ModelStreamDiagnostic) => void | Promise<void>;
}

/** 执行一个 Downcity 模型 Step 并收敛工具结果。 */
export async function run_model_step(input: RunModelStepInput): Promise<{
  /** 当前 Step 的 canonical Assistant Parts。 */
  assistant_parts: SessionAgentMessagePart[];
  /** 当前 Step 的运行结果。 */
  step_result: ModelStepResult;
}> {
  const call: ModelCall = {
    messages: [...convert_system_messages(input.system), ...input.messages],
    tools: convert_tools(input.tools),
  };
  const collector = new StepEventCollector();
  await consume_model_stream(
    input.model,
    call,
    input.abort_signal,
    () => collector.has_partial_output(),
    async (event) => {
      await input.assistant_output?.write_model_event(event);
      collector.accept(event);
    },
    input.on_diagnostic,
  );
  const collected = collector.finish();
  const tool_results = await execute_tools(
    collected.tool_calls,
    input,
    call.messages,
  );
  for (const result of tool_results) {
    await input.assistant_output?.write_tool_result({
      tool_call_id: result.tool_call_id,
      tool_name: result.tool_name,
      succeeded: result.success,
      output: result.output,
    });
  }
  const assistant_parts = append_tool_results(
    collected.assistant_parts,
    tool_results,
  );
  return {
    assistant_parts,
    step_result: {
      text: collected.text,
      finish_reason: collected.finish_reason,
      ...(collected.usage ? { usage: collected.usage } : {}),
      tool_calls: collected.tool_calls,
      tool_results,
      content: collected.tool_calls.map((tool_call) => ({
        type: "tool-call",
        ...tool_call,
      })),
    },
  };
}

/**
 * 模型事件聚合器。
 *
 * 内容块在 start 时按 content_id 登记并固定顺序；delta 与 finish 只更新原块。
 * 多个内容块允许交错结束，最终快照仍须与 canonical Writer 的开始顺序一致。
 */
class StepEventCollector {
  private readonly parts_by_content_id = new Map<string, SessionAgentMessagePart>();
  private readonly tool_by_content_id = new Map<string, ModelStepToolCall>();
  private usage?: ModelUsage;
  private finish_reason?: ModelFinishReason;
  private text = "";

  /** 当前调用是否已经产生不可安全重复的模型输出。 */
  has_partial_output(): boolean {
    return this.text.length > 0 ||
      [...this.parts_by_content_id.values()].some((part) => part.type !== "text");
  }

  /** 消费单个标准模型事件。 */
  accept(event: ModelStreamEvent): void {
    if (event.type === "text_start" || event.type === "reasoning_start") {
      const type = event.type === "text_start" ? "text" : "reasoning";
      this.parts_by_content_id.set(event.content_id, {
        part_id: `${type}:${event.content_id}`,
        sequence: this.parts_by_content_id.size + 1,
        type,
        text: "",
        state: "streaming",
      });
    } else if (event.type === "text_delta" || event.type === "reasoning_delta") {
      const type = event.type === "text_delta" ? "text" : "reasoning";
      const part = this.require_text_part(event.content_id, type);
      part.text += event.delta;
      if (event.type === "text_delta") this.text += event.delta;
    } else if (event.type === "text_finish" || event.type === "reasoning_finish") {
      const type = event.type === "text_finish" ? "text" : "reasoning";
      const part = this.require_text_part(event.content_id, type);
      part.state = "done";
      if (event.type === "reasoning_finish" && part.type === "reasoning" && event.signature) {
        part.reasoning_signature = event.signature;
      }
    } else if (event.type === "tool_call_start") {
      this.tool_by_content_id.set(event.content_id, {
        tool_call_id: event.tool_call_id,
        tool_name: event.tool_name,
        input: {},
      });
      this.parts_by_content_id.set(event.content_id, {
        part_id: `tool:${event.tool_call_id}`,
        sequence: this.parts_by_content_id.size + 1,
        type: "tool",
        tool_call_id: event.tool_call_id,
        tool_name: event.tool_name,
        state: "input-streaming",
      });
    } else if (event.type === "tool_call_finish") {
      const tool = this.tool_by_content_id.get(event.content_id);
      const part = this.parts_by_content_id.get(event.content_id);
      if (!tool || part?.type !== "tool") {
        throw new Error(`Model Step Tool Part not found: ${event.content_id}`);
      }
      tool.input = event.input;
      if (event.input_error) tool.input_error = event.input_error;
      part.input = event.input;
      part.state = "ready";
    } else if (event.type === "model_usage") {
      this.usage = event.usage;
    } else if (event.type === "model_finish") {
      this.finish_reason = event.finish_reason;
    }
  }

  /** 返回完整 Step 聚合结果。 */
  finish(): {
    assistant_parts: SessionAgentMessagePart[];
    finish_reason: ModelFinishReason;
    usage?: ModelUsage;
    text: string;
    tool_calls: ModelStepToolCall[];
  } {
    if (!this.finish_reason) throw new Error("Model stream ended without model_finish");
    return {
      assistant_parts: [...this.parts_by_content_id.values()],
      finish_reason: this.finish_reason,
      ...(this.usage ? { usage: this.usage } : {}),
      text: this.text,
      tool_calls: [...this.tool_by_content_id.values()],
    };
  }

  /** 读取由 start 创建的正文或推理块，后续事件不得改变类型与位置。 */
  private require_text_part(
    content_id: string,
    type: "text" | "reasoning",
  ): Extract<SessionAgentMessagePart, { type: "text" | "reasoning" }> {
    const part = this.parts_by_content_id.get(content_id);
    if (!part || (part.type !== "text" && part.type !== "reasoning") || part.type !== type) {
      throw new Error(`Model Step ${type} Part not found: ${content_id}`);
    }
    return part;
  }
}

/** 执行当前 Step 中的全部工具调用。 */
async function execute_tools(
  calls: ModelStepToolCall[],
  input: RunModelStepInput,
  messages: ModelMessage[],
): Promise<ModelStepToolResult[]> {
  const results: ModelStepToolResult[] = [];
  for (const call of calls) {
    if (call.input_error) {
      results.push({
        ...call,
        success: false,
        output: { error: call.input_error },
      });
      continue;
    }
    const tool = input.tools[call.tool_name];
    if (!tool || typeof tool.execute !== "function") {
      results.push({
        ...call,
        success: false,
        output: { error: `Unknown tool: ${call.tool_name}` },
      });
      continue;
    }
    try {
      const site: ToolCallSite = {
        tool_call_id: call.tool_call_id,
        messages,
        ...(input.abort_signal ? { abort_signal: input.abort_signal } : {}),
      };
      const prepared = tool.prepare_input
        ? await tool.prepare_input(call.input, site)
        : { public_input: call.input, execution_input: call.input };
      const validated = validate_tool_input({
        tool,
        tool_name: call.tool_name,
        input: prepared.execution_input,
      });
      if ("error" in validated) {
        results.push({
          ...call,
          success: false,
          output: { error: tool.redact_output?.(validated.error) ?? validated.error },
        });
        continue;
      }
      const output = await tool.execute(validated.input, site);
      results.push({
        ...call,
        input: prepared.public_input,
        success: !is_structured_tool_failure(output),
        output,
      });
    } catch (error) {
      results.push({
        ...call,
        success: false,
        output: { error: tool.redact_output?.(error instanceof Error ? error.message : String(error)) ?? (error instanceof Error ? error.message : String(error)) },
      });
    }
  }
  return results;
}

/** 识别 Tool 正常返回的结构化失败，避免把业务失败标记成执行成功。 */
function is_structured_tool_failure(output: unknown): boolean {
  if (!output || typeof output !== "object" || Array.isArray(output)) return false;
  return (output as { success?: unknown }).success === false;
}

/** 把 System 快照转换成标准 ModelMessage。 */
function convert_system_messages(messages: SessionSystemMessage[]): ModelMessage[] {
  return messages.map((message) => ({
    role: "system",
    content: [{
      type: "text",
      text: typeof message === "string"
        ? message
        : String(message.content ?? ""),
    }],
  }));
}

/** 把已绑定工具定义转换为只含 JSON Schema 的模型协议。 */
function convert_tools(tools: Record<string, BoundAgentTool>): ModelTool[] {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description ?? "",
    input_schema: read_input_schema(tool.input_schema),
  }));
}

/** 将工具当前使用的 JSON Schema 或 Zod Schema 收敛为协议 JSON Schema。 */
function read_input_schema(value: unknown): Record<string, ModelJsonValue> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  if (record.jsonSchema && typeof record.jsonSchema === "object") {
    return record.jsonSchema as Record<string, ModelJsonValue>;
  }
  try {
    return z.toJSONSchema(value as z.ZodType) as Record<string, ModelJsonValue>;
  } catch {
    return record as Record<string, ModelJsonValue>;
  }
}

/** 将任意工具输出限制为可传输 JSON。 */
function to_model_json_value(value: unknown): ModelJsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as ModelJsonValue;
}

/** 把工具结果合并到 canonical Tool Parts。 */
function append_tool_results(
  parts: SessionAgentMessagePart[],
  results: ModelStepToolResult[],
): SessionAgentMessagePart[] {
  if (results.length === 0) return parts;
  const result_by_id = new Map(results.map((result) => [result.tool_call_id, result]));
  return parts.map((part) => {
    if (part.type !== "tool") return part;
    const result = result_by_id.get(part.tool_call_id);
    if (!result) return part;
    return result.success
      ? {
          ...part,
          state: "completed",
          output: to_model_json_value(result.output),
        } satisfies SessionAgentToolPart
      : {
          ...part,
          state: "failed",
          error: read_tool_error(result.output),
        } satisfies SessionAgentToolPart;
  });
}

/** 从结构化工具失败结果中提取可展示错误文本。 */
function read_tool_error(value: unknown): string {
  if (value && typeof value === "object") {
    const result = value as { error?: unknown; message?: unknown; output?: unknown };
    for (const candidate of [result.error, result.message, result.output]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
  }
  return "Tool execution failed";
}
