/**
 * OpenAI Chat Completions 与 Downcity Model Protocol 的边界适配模块。
 *
 * OpenAI 类型只存在于本文件；AIService、路由和 AIChannel 只处理 Downcity 协议。
 */

import { ModelStreamValidator } from "@downcity/type";
import type {
  ModelCall,
  ModelContent,
  ModelFileContent,
  ModelFinishReason,
  ModelJsonValue,
  ModelMessage,
  ModelStreamEvent,
  ModelTool,
  ModelToolCallContent,
  ModelUsage,
} from "@downcity/type";
import type { AIChannelStreamResult } from "../../types/AI.js";
import type {
  ModelCompletionResult,
  OpenAIChatCompletionExecution,
  OpenAIChatCompletionRequest,
  OpenAIChatContentPart,
  OpenAIChatMessage,
  OpenAIChatResponseFormat,
  OpenAIChatTool,
  OpenAIChatToolChoice,
  OpenAIChatUsage,
} from "../../types/AITransport.js";

const OPENAI_SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
} as const;

/** 将 OpenAI Chat Completions 请求转换为 Downcity ModelCall。 */
export function openai_chat_request_to_language_model_call(
  request: OpenAIChatCompletionRequest,
): ModelCall {
  if (!Array.isArray(request.messages)) throw create_request_error("messages must be an array");
  const max_output_tokens = read_optional_number(request.max_completion_tokens ?? request.max_tokens);
  const tools = convert_tools(request.tools);
  const tool_choice = convert_tool_choice(request.tool_choice);
  const response_format = convert_response_format(request.response_format);
  const reasoning_effort = read_optional_string(request.reasoning_effort);
  return {
    messages: convert_messages(request.messages),
    ...(max_output_tokens !== undefined ? { max_output_tokens } : {}),
    ...(read_optional_number(request.temperature) !== undefined
      ? { temperature: read_optional_number(request.temperature) } : {}),
    ...(read_optional_number(request.top_p) !== undefined
      ? { top_p: read_optional_number(request.top_p) } : {}),
    ...(typeof request.stop === "string"
      ? { stop_sequences: [request.stop] }
      : Array.isArray(request.stop)
        ? { stop_sequences: request.stop.filter((item): item is string => typeof item === "string") }
        : {}),
    ...(read_optional_number(request.presence_penalty) !== undefined
      ? { presence_penalty: read_optional_number(request.presence_penalty) } : {}),
    ...(read_optional_number(request.frequency_penalty) !== undefined
      ? { frequency_penalty: read_optional_number(request.frequency_penalty) } : {}),
    ...(Number.isInteger(request.seed) ? { seed: request.seed } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(tool_choice ? { tool_choice } : {}),
    ...(response_format ? { response_format } : {}),
    ...(reasoning_effort ? { reasoning: { enabled: true, effort: reasoning_effort } } : {}),
  };
}

/** 将 Downcity 模型事件流转换为 OpenAI JSON 或 SSE。 */
export async function create_openai_chat_completion_response(input: {
  /** Federation 对外模型 ID。 */
  model_id: string;
  /** 是否返回 SSE。 */
  stream: boolean;
  /** AIChannel 返回的标准 Downcity 流。 */
  result: AIChannelStreamResult;
}): Promise<OpenAIChatCompletionExecution> {
  return input.stream
    ? create_stream_response(input.model_id, input.result.stream)
    : create_json_response(input.model_id, input.result.stream);
}

/** 收集完整流并生成 OpenAI 非流式响应。 */
async function create_json_response(
  model_id: string,
  stream: ReadableStream<ModelStreamEvent>,
): Promise<OpenAIChatCompletionExecution> {
  const completion = await collect_model_stream(stream);
  const tool_calls = completion.message.content
    .filter((content): content is ModelToolCallContent => content.type === "tool_call")
    .map(to_openai_tool_call);
  const content = completion.message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  const body = {
    id: `chatcmpl_${crypto.randomUUID().replaceAll("-", "")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: model_id,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: content || null,
        ...(tool_calls.length > 0 ? { tool_calls } : {}),
      },
      finish_reason: to_openai_finish_reason(completion.finish_reason),
    }],
    ...(completion.usage ? { usage: to_openai_usage(completion.usage) } : {}),
  };
  return { response: Response.json(body), completion: Promise.resolve(completion) };
}

/** 增量转换 Downcity 事件并生成 OpenAI SSE。 */
function create_stream_response(
  model_id: string,
  source: ReadableStream<ModelStreamEvent>,
): OpenAIChatCompletionExecution {
  const reader = source.getReader();
  const encoder = new TextEncoder();
  const collector = new ModelEventCollector();
  const validator = new ModelStreamValidator();
  const completion_id = `chatcmpl_${crypto.randomUUID().replaceAll("-", "")}`;
  let resolve_completion: (value: ModelCompletionResult | undefined) => void = () => undefined;
  const completion = new Promise<ModelCompletionResult | undefined>((resolve) => {
    resolve_completion = resolve;
  });
  const response_stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          validator.finish();
          resolve_completion(collector.result_or_undefined());
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        validator.accept(next.value);
        collector.accept(next.value);
        const chunk = to_openai_stream_chunk(completion_id, model_id, next.value);
        if (chunk) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      } catch {
        resolve_completion(undefined);
        controller.close();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      resolve_completion(undefined);
    },
  });
  return {
    response: new Response(response_stream, { status: 200, headers: OPENAI_SSE_HEADERS }),
    completion,
  };
}

/** 将单个 Downcity 事件投影为 OpenAI chunk。 */
function to_openai_stream_chunk(id: string, model: string, event: ModelStreamEvent): unknown {
  const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model };
  if (event.type === "model_start") {
    return { ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] };
  }
  if (event.type === "text_delta") {
    return { ...base, choices: [{ index: 0, delta: { content: event.delta }, finish_reason: null }] };
  }
  if (event.type === "tool_call_start") {
    return {
      ...base,
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: event.tool_call_id, type: "function", function: { name: event.tool_name, arguments: "" } }] }, finish_reason: null }],
    };
  }
  if (event.type === "tool_call_delta") {
    return { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: event.input_delta } }] }, finish_reason: null }] };
  }
  if (event.type === "model_finish") {
    return { ...base, choices: [{ index: 0, delta: {}, finish_reason: to_openai_finish_reason(event.finish_reason) }] };
  }
  if (event.type === "model_usage") return { ...base, choices: [], usage: to_openai_usage(event.usage) };
  return undefined;
}

/** 收集标准模型流。 */
async function collect_model_stream(stream: ReadableStream<ModelStreamEvent>): Promise<ModelCompletionResult> {
  const collector = new ModelEventCollector();
  const validator = new ModelStreamValidator();
  for await (const event of stream) {
    validator.accept(event);
    collector.accept(event);
  }
  validator.finish();
  const result = collector.result_or_undefined();
  if (!result) throw new Error("Model stream ended without model_finish");
  return result;
}

/** 将事件状态聚合为单个 assistant ModelMessage。 */
class ModelEventCollector {
  private readonly content: ModelContent[] = [];
  private readonly text = new Map<string, string>();
  private readonly reasoning = new Map<string, string>();
  private readonly tools = new Map<string, { tool_call_id: string; tool_name: string }>();
  private usage?: ModelUsage;
  private finish_reason?: ModelFinishReason;

  /** 消费单个已校验的模型事件。 */
  accept(event: ModelStreamEvent): void {
    if (event.type === "text_start") this.text.set(event.content_id, "");
    else if (event.type === "text_delta") this.text.set(event.content_id, (this.text.get(event.content_id) ?? "") + event.delta);
    else if (event.type === "text_finish") this.content.push({ type: "text", text: this.text.get(event.content_id) ?? "" });
    else if (event.type === "reasoning_start") this.reasoning.set(event.content_id, "");
    else if (event.type === "reasoning_delta") this.reasoning.set(event.content_id, (this.reasoning.get(event.content_id) ?? "") + event.delta);
    else if (event.type === "reasoning_finish") this.content.push({ type: "reasoning", text: this.reasoning.get(event.content_id) ?? "", ...(event.signature ? { signature: event.signature } : {}) });
    else if (event.type === "tool_call_start") this.tools.set(event.content_id, { tool_call_id: event.tool_call_id, tool_name: event.tool_name });
    else if (event.type === "tool_call_finish") {
      const tool = this.tools.get(event.content_id);
      if (tool) this.content.push({ type: "tool_call", ...tool, input: event.input });
    } else if (event.type === "model_usage") this.usage = event.usage;
    else if (event.type === "model_finish") this.finish_reason = event.finish_reason;
    else if (event.type === "model_error") throw new Error(event.error.message);
  }

  /** 仅在收到完成事件后返回聚合结果。 */
  result_or_undefined(): ModelCompletionResult | undefined {
    return this.finish_reason
      ? { message: { role: "assistant", content: this.content }, finish_reason: this.finish_reason, ...(this.usage ? { usage: this.usage } : {}) }
      : undefined;
  }
}

/** 将 OpenAI 消息转换为 Downcity 消息。 */
function convert_messages(messages: OpenAIChatMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role === "tool") return convert_tool_message(message);
    const role = message.role === "developer" ? "system" : message.role;
    const content = convert_content(message.content);
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      content.push(...message.tool_calls.map((tool_call): ModelToolCallContent => ({
        type: "tool_call",
        tool_call_id: tool_call.id,
        tool_name: tool_call.function.name,
        input: parse_json_value(tool_call.function.arguments),
      })));
    }
    return { role, content: content.length > 0 ? content : [{ type: "text", text: "" }] } as ModelMessage;
  });
}

/** 转换 OpenAI tool 角色消息。 */
function convert_tool_message(message: OpenAIChatMessage): ModelMessage {
  const tool_call_id = read_optional_string(message.tool_call_id);
  if (!tool_call_id) throw create_request_error("tool message requires tool_call_id");
  return {
    role: "tool",
    content: [{
      type: "tool_result",
      tool_call_id,
      tool_name: read_optional_string(message.name) ?? "tool",
      outcome: "succeeded",
      content: convert_content(message.content).flatMap((part) => part.type === "text" || part.type === "file" ? [part] : []),
    }],
  };
}

/** 转换 OpenAI 文本或多模态内容。 */
function convert_content(content: OpenAIChatMessage["content"]): ModelContent[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap(convert_content_part);
}

/** 转换单个 OpenAI content part。 */
function convert_content_part(part: OpenAIChatContentPart): ModelContent[] {
  if (part.type === "text" || part.type === "input_text") return [{ type: "text", text: part.text }];
  if (part.type === "image_url" || part.type === "input_image") {
    const url = read_optional_string(part.url) ?? read_optional_string(part.image_url?.url);
    return url ? [{ type: "file", media_type: "image/*", source: { type: "url", url } }] : [];
  }
  if (part.type !== "file") return [];
  const media_type = read_optional_string(part.media_type) ?? read_optional_string(part.mediaType);
  if (!media_type || !read_optional_string(part.url)) return [];
  const filename = read_optional_string(part.filename);
  const file: ModelFileContent = {
    type: "file",
    media_type,
    source: { type: "url", url: part.url },
    ...(filename ? { filename } : {}),
  };
  return [file];
}

/** 转换 OpenAI 工具定义。 */
function convert_tools(tools: OpenAIChatTool[] | undefined): ModelTool[] {
  return (tools ?? []).map((tool) => ({
    name: tool.function.name,
    description: tool.function.description ?? "",
    input_schema: tool.function.parameters as Record<string, ModelJsonValue> ?? {},
  }));
}

/** 转换 OpenAI 工具选择策略。 */
function convert_tool_choice(choice: OpenAIChatToolChoice | undefined): ModelCall["tool_choice"] {
  if (!choice) return undefined;
  if (choice === "auto" || choice === "none" || choice === "required") return { type: choice };
  return { type: "tool", tool_name: choice.function.name };
}

/** 转换 OpenAI 输出格式。 */
function convert_response_format(format: OpenAIChatResponseFormat | undefined): ModelCall["response_format"] {
  if (!format || format.type === "text") return format ? { type: "text" } : undefined;
  if (format.type === "json_object") return { type: "json" };
  return {
    type: "json_schema",
    name: format.json_schema.name,
    ...(format.json_schema.description ? { description: format.json_schema.description } : {}),
    schema: format.json_schema.schema as Record<string, ModelJsonValue>,
  };
}

/** 转换工具调用为 OpenAI 格式。 */
function to_openai_tool_call(content: ModelToolCallContent): unknown {
  return { id: content.tool_call_id, type: "function", function: { name: content.tool_name, arguments: JSON.stringify(content.input) } };
}

/** 转换标准完成原因。 */
function to_openai_finish_reason(reason: ModelFinishReason): string {
  if (reason === "tool_call") return "tool_calls";
  if (reason === "content_filter") return "content_filter";
  if (reason === "length") return "length";
  return reason === "stop" ? "stop" : "stop";
}

/** 转换标准 usage。 */
function to_openai_usage(usage: ModelUsage): OpenAIChatUsage {
  return {
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
    ...(usage.cached_input_tokens !== undefined ? { prompt_tokens_details: { cached_tokens: usage.cached_input_tokens } } : {}),
    ...(usage.reasoning_tokens !== undefined ? { completion_tokens_details: { reasoning_tokens: usage.reasoning_tokens } } : {}),
  };
}

/** 安全解析工具参数 JSON。 */
function parse_json_value(value: string): ModelJsonValue {
  try {
    return JSON.parse(value) as ModelJsonValue;
  } catch {
    throw create_request_error("tool call arguments must be valid JSON");
  }
}

/** 读取有限数字。 */
function read_optional_number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 读取非空字符串。 */
function read_optional_string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 创建 422 请求错误。 */
function create_request_error(message: string): Error {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 422;
  return error;
}
