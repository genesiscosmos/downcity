/**
 * Downcity 模型 step 执行模块。
 *
 * 该模块消费 ModelClient 事件、聚合 assistant 消息并执行当前 step 的工具调用。
 */

import type {
  ModelCall,
  ModelClient,
  ModelContent,
  ModelFinishReason,
  ModelJsonValue,
  ModelMessage,
  ModelStreamEvent,
  ModelTool,
  ModelToolCallContent,
  ModelUsage,
  RuntimeTool as Tool,
  RuntimeToolExecutionOptions as ToolExecutionOptions,
} from "@downcity/type";
import { ModelStreamValidator } from "@downcity/type";
import { z } from "zod";
import type { SessionMessageRecordV1 } from "@/executor/types/SessionRecords.js";
import type { SessionSystemMessage } from "@/executor/types/SessionPrompts.js";
import type { SessionUiMessageChunkCallback } from "@/types/session/SessionExecution.js";
import { generate_id } from "@/utils/Id.js";

/** 单个工具调用的执行事实。 */
export interface ModelStepToolCall {
  /** 工具调用 ID。 */
  toolCallId: string;
  /** 工具名称。 */
  toolName: string;
  /** 已解析工具输入。 */
  input: ModelJsonValue;
}

/** 单个工具结果的执行事实。 */
export interface ModelStepToolResult extends ModelStepToolCall {
  /** 工具执行是否成功。 */
  success: boolean;
  /** 工具返回或错误信息。 */
  output: unknown;
}

/** Agent 内部单个模型 step 的稳定结果。 */
export interface ModelStepResult {
  /** 聚合后的普通文本。 */
  text: string;
  /** 标准完成原因。 */
  finishReason: ModelFinishReason;
  /** Provider 返回的累计 usage。 */
  usage?: ModelUsage;
  /** 当前 step 的工具调用。 */
  toolCalls: ModelStepToolCall[];
  /** 当前 step 的工具结果。 */
  toolResults: ModelStepToolResult[];
  /** 用于后续模型 step 的消息。 */
  response: { messages: ModelMessage[] };
  /** 供现有诊断代码读取的内容事实。 */
  content: Array<Record<string, unknown>>;
}

/** 执行一个模型 step 的输入。 */
export interface RunModelStepInput {
  /** 当前 step 的模型客户端。 */
  model: ModelClient;
  /** 当前 system 消息。 */
  system: SessionSystemMessage[];
  /** 当前模型上下文。 */
  messages: ModelMessage[];
  /** 当前可用工具运行时。 */
  tools: Record<string, Tool>;
  /** 当前 Session ID。 */
  session_id: string;
  /** 当前取消信号。 */
  abort_signal: AbortSignal;
  /** 可选 UI 增量投影回调。 */
  on_chunk?: SessionUiMessageChunkCallback;
  /** 工具执行前的审批回调。 */
  approve_tool?: (call: ModelStepToolCall, tool: Tool) => Promise<boolean>;
}

/** 执行一个 Downcity 模型 step 并收敛工具结果。 */
export async function run_model_step(input: RunModelStepInput): Promise<{
  /** 当前 step 的 canonical assistant 消息。 */
  assistant_message: SessionMessageRecordV1;
  /** 当前 step 的运行结果。 */
  step_result: ModelStepResult;
}> {
  const call: ModelCall = {
    messages: [...convert_system_messages(input.system), ...input.messages],
    tools: convert_tools(input.tools),
  };
  const stream = await input.model.stream(call, input.abort_signal);
  const collector = new StepEventCollector(input.session_id, input.on_chunk);
  const validator = new ModelStreamValidator();
  for await (const event of stream) {
    validator.accept(event);
    await collector.accept(event);
  }
  validator.finish();
  const collected = collector.finish();
  const tool_results = await execute_tools(collected.tool_calls, input, call.messages);
  for (const result of tool_results) {
    await input.on_chunk?.(result.success
      ? { type: "tool-output-available", toolCallId: result.toolCallId, output: result.output }
      : {
          type: "tool-output-error",
          toolCallId: result.toolCallId,
          errorText: read_tool_error(result.output),
        });
  }
  const response_messages: ModelMessage[] = [collected.assistant_model_message];
  if (tool_results.length > 0) {
    response_messages.push({
      role: "tool",
      content: tool_results.map((result) => ({
        type: "tool_result",
        tool_call_id: result.toolCallId,
        tool_name: result.toolName,
        outcome: result.success ? "succeeded" : "failed",
        content: [{ type: "json", value: to_model_json_value(result.output) }],
      })),
    });
  }
  const assistant_message = append_tool_results(
    collected.assistant_message,
    tool_results,
  );
  return {
    assistant_message,
    step_result: {
      text: collected.text,
      finishReason: collected.finish_reason,
      ...(collected.usage ? { usage: collected.usage } : {}),
      toolCalls: collected.tool_calls,
      toolResults: tool_results,
      response: { messages: response_messages },
      content: collected.tool_calls.map((tool_call) => ({
        type: "tool-call",
        ...tool_call,
      })),
    },
  };
}

/** 模型事件聚合器。 */
class StepEventCollector {
  private readonly model_content: ModelContent[] = [];
  private readonly ui_parts: Array<Record<string, unknown>> = [];
  private readonly text_by_id = new Map<string, string>();
  private readonly reasoning_by_id = new Map<string, string>();
  private readonly tool_by_content_id = new Map<string, ModelStepToolCall>();
  private usage?: ModelUsage;
  private finish_reason?: ModelFinishReason;
  private text = "";

  constructor(
    private readonly session_id: string,
    private readonly on_chunk?: SessionUiMessageChunkCallback,
  ) {}

  /** 消费单个模型事件并投影 UI 增量。 */
  async accept(event: ModelStreamEvent): Promise<void> {
    if (event.type === "model_error") throw new Error(event.error.message);
    if (event.type === "text_start") {
      this.text_by_id.set(event.content_id, "");
      await this.emit({ type: "text-start", id: event.content_id });
    } else if (event.type === "text_delta") {
      this.text_by_id.set(event.content_id, (this.text_by_id.get(event.content_id) ?? "") + event.delta);
      this.text += event.delta;
      await this.emit({ type: "text-delta", id: event.content_id, delta: event.delta });
    } else if (event.type === "text_finish") {
      const text = this.text_by_id.get(event.content_id) ?? "";
      this.model_content.push({ type: "text", text });
      this.ui_parts.push({ type: "text", text });
      await this.emit({ type: "text-end", id: event.content_id });
    } else if (event.type === "reasoning_start") {
      this.reasoning_by_id.set(event.content_id, "");
      await this.emit({ type: "reasoning-start", id: event.content_id });
    } else if (event.type === "reasoning_delta") {
      this.reasoning_by_id.set(event.content_id, (this.reasoning_by_id.get(event.content_id) ?? "") + event.delta);
      await this.emit({ type: "reasoning-delta", id: event.content_id, delta: event.delta });
    } else if (event.type === "reasoning_finish") {
      const text = this.reasoning_by_id.get(event.content_id) ?? "";
      this.model_content.push({ type: "reasoning", text, ...(event.signature ? { signature: event.signature } : {}) });
      this.ui_parts.push({ type: "reasoning", text });
      await this.emit({ type: "reasoning-end", id: event.content_id });
    } else if (event.type === "tool_call_start") {
      this.tool_by_content_id.set(event.content_id, {
        toolCallId: event.tool_call_id,
        toolName: event.tool_name,
        input: {},
      });
      await this.emit({ type: "tool-input-start", toolCallId: event.tool_call_id, toolName: event.tool_name });
    } else if (event.type === "tool_call_delta") {
      const tool = this.tool_by_content_id.get(event.content_id);
      if (tool) await this.emit({ type: "tool-input-delta", toolCallId: tool.toolCallId, inputTextDelta: event.input_delta });
    } else if (event.type === "tool_call_finish") {
      const tool = this.tool_by_content_id.get(event.content_id);
      if (tool) {
        tool.input = event.input;
        this.model_content.push({ type: "tool_call", tool_call_id: tool.toolCallId, tool_name: tool.toolName, input: tool.input });
        this.ui_parts.push({ type: `tool-${tool.toolName}`, toolCallId: tool.toolCallId, state: "input-available", input: tool.input });
        await this.emit({ type: "tool-input-available", toolCallId: tool.toolCallId, toolName: tool.toolName, input: tool.input });
      }
    } else if (event.type === "model_usage") this.usage = event.usage;
    else if (event.type === "model_finish") this.finish_reason = event.finish_reason;
  }

  /** 返回完整 step 聚合结果。 */
  finish(): {
    assistant_message: SessionMessageRecordV1;
    assistant_model_message: ModelMessage;
    finish_reason: ModelFinishReason;
    usage?: ModelUsage;
    text: string;
    tool_calls: ModelStepToolCall[];
  } {
    if (!this.finish_reason) throw new Error("Model stream ended without model_finish");
    const assistant_message = {
      id: `a:${this.session_id}:${generate_id()}`,
      role: "assistant" as const,
      metadata: {
        v: 1 as const,
        ts: Date.now(),
        session_id: this.session_id,
        source: "egress" as const,
        kind: "normal" as const,
      },
      parts: this.ui_parts as SessionMessageRecordV1["parts"],
    };
    return {
      assistant_message,
      assistant_model_message: { role: "assistant", content: this.model_content },
      finish_reason: this.finish_reason,
      ...(this.usage ? { usage: this.usage } : {}),
      text: this.text,
      tool_calls: [...this.tool_by_content_id.values()],
    };
  }

  /** 将 Downcity 事件投影为现有 Session 输出增量。 */
  private async emit(chunk: Record<string, unknown>): Promise<void> {
    await this.on_chunk?.(chunk as never);
  }
}

/** 执行当前 step 中的全部工具调用。 */
async function execute_tools(
  calls: ModelStepToolCall[],
  input: RunModelStepInput,
  messages: ModelMessage[],
): Promise<ModelStepToolResult[]> {
  const results: ModelStepToolResult[] = [];
  for (const call of calls) {
    const tool = input.tools[call.toolName];
    if (!tool || typeof tool.execute !== "function") {
      results.push({ ...call, success: false, output: { error: `Unknown tool: ${call.toolName}` } });
      continue;
    }
    const approved = input.approve_tool ? await input.approve_tool(call, tool) : true;
    if (!approved) {
      results.push({ ...call, success: false, output: { error: "Tool execution denied" } });
      continue;
    }
    try {
      const options: ToolExecutionOptions = {
        tool_call_id: call.toolCallId,
        messages,
        abort_signal: input.abort_signal,
      };
      const output = await tool.execute(call.input, options);
      results.push({ ...call, success: true, output });
    } catch (error) {
      results.push({ ...call, success: false, output: { error: error instanceof Error ? error.message : String(error) } });
    }
  }
  return results;
}

/** 把 system 快照转换成标准 ModelMessage。 */
function convert_system_messages(messages: SessionSystemMessage[]): ModelMessage[] {
  return messages.map((message) => ({
    role: "system",
    content: [{ type: "text", text: typeof message === "string" ? message : String(message.content ?? "") }],
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

/** 将 AI Tool 当前使用的 JSON Schema 或 Zod Schema 收敛为协议 JSON Schema。 */
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

/** 从结构化工具失败结果中提取可展示错误文本。 */
function read_tool_error(value: unknown): string {
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return "Tool execution failed";
}

/** 把工具结果合并到 assistant UI parts。 */
function append_tool_results(
  message: SessionMessageRecordV1,
  results: ModelStepToolResult[],
): SessionMessageRecordV1 {
  if (results.length === 0) return message;
  const result_by_id = new Map(results.map((result) => [result.toolCallId, result]));
  return {
    ...message,
    parts: message.parts.map((part) => {
      const record = part as unknown as Record<string, unknown>;
      const result = result_by_id.get(String(record.toolCallId ?? ""));
      return result
        ? { ...record, state: result.success ? "output-available" : "output-error", output: result.output }
        : part;
    }) as SessionMessageRecordV1["parts"],
  };
}
