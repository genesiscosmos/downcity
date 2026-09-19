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
  type RuntimeTool as Tool,
  type RuntimeToolExecutionOptions as ToolExecutionOptions,
} from "@downcity/type";
import { z } from "zod";
import type { SessionSystemMessage } from "@/types/session/SessionPrompts.js";
import type { SessionAssistantOutput } from "@/types/turn/SessionAssistantOutput.js";
import type {
  SessionAgentMessagePart,
  SessionAgentToolPart,
} from "@downcity/type";
import { consume_model_stream } from "@/model/ModelStreamConsumer.js";

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
  /** 当前可用工具运行时。 */
  tools: Record<string, Tool>;
  /** 当前取消信号。 */
  abort_signal: AbortSignal;
  /** canonical Assistant 输出端口。 */
  assistant_output?: SessionAssistantOutput;
  /** 工具执行前的审批回调。 */
  approve_tool?: (call: ModelStepToolCall, tool: Tool) => Promise<boolean>;
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

/** 模型事件聚合器。 */
class StepEventCollector {
  private readonly assistant_parts: SessionAgentMessagePart[] = [];
  private readonly text_by_id = new Map<string, string>();
  private readonly reasoning_by_id = new Map<string, string>();
  private readonly tool_by_content_id = new Map<string, ModelStepToolCall>();
  private usage?: ModelUsage;
  private finish_reason?: ModelFinishReason;
  private text = "";

  /** 当前调用是否已经产生不可安全重复的模型输出。 */
  has_partial_output(): boolean {
    return this.text.length > 0 ||
      this.reasoning_by_id.size > 0 ||
      this.tool_by_content_id.size > 0;
  }

  /** 消费单个标准模型事件。 */
  accept(event: ModelStreamEvent): void {
    if (event.type === "text_start") {
      this.text_by_id.set(event.content_id, "");
    } else if (event.type === "text_delta") {
      this.text_by_id.set(
        event.content_id,
        (this.text_by_id.get(event.content_id) ?? "") + event.delta,
      );
      this.text += event.delta;
    } else if (event.type === "text_finish") {
      const text = this.text_by_id.get(event.content_id) ?? "";
      this.assistant_parts.push({
        part_id: `text:${event.content_id}`,
        sequence: this.assistant_parts.length + 1,
        type: "text",
        text,
        state: "done",
      });
    } else if (event.type === "reasoning_start") {
      this.reasoning_by_id.set(event.content_id, "");
    } else if (event.type === "reasoning_delta") {
      this.reasoning_by_id.set(
        event.content_id,
        (this.reasoning_by_id.get(event.content_id) ?? "") + event.delta,
      );
    } else if (event.type === "reasoning_finish") {
      const text = this.reasoning_by_id.get(event.content_id) ?? "";
      this.assistant_parts.push({
        part_id: `reasoning:${event.content_id}`,
        sequence: this.assistant_parts.length + 1,
        type: "reasoning",
        text,
        state: "done",
        ...(event.signature ? { reasoning_signature: event.signature } : {}),
      });
    } else if (event.type === "tool_call_start") {
      this.tool_by_content_id.set(event.content_id, {
        tool_call_id: event.tool_call_id,
        tool_name: event.tool_name,
        input: {},
      });
    } else if (event.type === "tool_call_finish") {
      const tool = this.tool_by_content_id.get(event.content_id);
      if (tool) {
        tool.input = event.input;
        if (event.input_error) tool.input_error = event.input_error;
        this.assistant_parts.push({
          part_id: `tool:${tool.tool_call_id}`,
          sequence: this.assistant_parts.length + 1,
          type: "tool",
          tool_call_id: tool.tool_call_id,
          tool_name: tool.tool_name,
          state: "ready",
          input: tool.input,
        });
      }
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
      assistant_parts: this.assistant_parts,
      finish_reason: this.finish_reason,
      ...(this.usage ? { usage: this.usage } : {}),
      text: this.text,
      tool_calls: [...this.tool_by_content_id.values()],
    };
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
    const approved = input.approve_tool
      ? await input.approve_tool(call, tool)
      : true;
    if (!approved) {
      results.push({
        ...call,
        success: false,
        output: { error: "Tool execution denied" },
      });
      continue;
    }
    try {
      const options: ToolExecutionOptions = {
        tool_call_id: call.tool_call_id,
        messages,
        abort_signal: input.abort_signal,
      };
      const output = await tool.execute(call.input, options);
      results.push({
        ...call,
        success: !is_structured_tool_failure(output),
        output,
      });
    } catch (error) {
      results.push({
        ...call,
        success: false,
        output: { error: error instanceof Error ? error.message : String(error) },
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

/** 把 Agent 工具定义转换为只含 JSON Schema 的模型协议。 */
function convert_tools(tools: Record<string, Tool>): ModelTool[] {
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
