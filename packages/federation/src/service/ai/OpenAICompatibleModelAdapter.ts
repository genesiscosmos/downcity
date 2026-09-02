/**
 * OpenAI-compatible Provider Adapter。
 *
 * 本模块是第三方协议边界，负责把 Downcity ModelCall 转为 Chat Completions 请求，
 * 并把上游 SSE 规范化为 ModelStreamEvent。路由、fallback、计费和工具执行不属于本模块。
 */

import type {
  ModelContent,
  ModelFileContent,
  ModelFinishReason,
  ModelJsonValue,
  ModelClient,
  ModelMessage,
  ModelStreamEvent,
  ModelToolChoice,
  ModelToolResultPart,
  ModelUsage,
} from "@downcity/type";
import type { AIChannelStreamInput, AIChannelStreamResult } from "../../types/AI.js";
import type {
  OpenAICompatibleModelAdapterOptions,
  OpenAICompatibleModelClientOptions,
} from "../../types/OpenAICompatibleModel.js";

/** 创建不依赖 Federation HTTP 的进程内 OpenAI-compatible ModelClient。 */
export function create_openai_compatible_model(
  options: OpenAICompatibleModelClientOptions,
): ModelClient {
  return {
    id: options.id,
    async stream(call, signal) {
      const result = await stream_openai_compatible_model({
        call,
        model: { id: options.id, upstream_model: options.upstream_model },
        env: () => undefined,
        ...(call.reasoning?.enabled && call.reasoning.effort
          ? { reasoning: { effort: call.reasoning.effort, source: "request" } }
          : {}),
        ...(signal ? { abort_signal: signal } : {}),
      }, options);
      return result.stream;
    },
  };
}

/** 使用 OpenAI-compatible Chat Completions 执行标准 Downcity 模型调用。 */
export async function stream_openai_compatible_model(
  input: AIChannelStreamInput,
  options: OpenAICompatibleModelAdapterOptions,
): Promise<AIChannelStreamResult> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const response = await fetcher(`${trim_trailing_slash(options.base_url)}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
      authorization: `Bearer ${options.api_key}`,
    },
    body: JSON.stringify(build_request(input)),
    signal: input.abort_signal,
  });
  if (!response.ok) throw await create_upstream_error(response);
  if (!response.body) throw new Error("OpenAI-compatible provider returned an empty response body");

  const request_id = response.headers.get("x-request-id") ?? `req_${crypto.randomUUID()}`;
  return {
    stream: create_event_stream(response.body, {
      request_id,
      model_id: input.model.id,
    }),
    request: {
      request_id,
      metadata: { provider_protocol: "openai_chat_completions" },
    },
  };
}

/** 构造上游 Chat Completions 请求。 */
function build_request(input: AIChannelStreamInput): Record<string, unknown> {
  const call = input.call;
  return {
    ...(input.provider_options ?? {}),
    model: input.model.upstream_model,
    messages: call.messages.flatMap(convert_message),
    stream: true,
    stream_options: { include_usage: true },
    ...(call.tools?.length
      ? { tools: call.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
          },
        })) }
      : {}),
    ...(call.tool_choice ? { tool_choice: convert_tool_choice(call.tool_choice) } : {}),
    ...(call.max_output_tokens !== undefined ? { max_tokens: call.max_output_tokens } : {}),
    ...(call.temperature !== undefined ? { temperature: call.temperature } : {}),
    ...(call.top_p !== undefined ? { top_p: call.top_p } : {}),
    ...(call.presence_penalty !== undefined ? { presence_penalty: call.presence_penalty } : {}),
    ...(call.frequency_penalty !== undefined ? { frequency_penalty: call.frequency_penalty } : {}),
    ...(call.stop_sequences?.length ? { stop: call.stop_sequences } : {}),
    ...(call.seed !== undefined ? { seed: call.seed } : {}),
    ...(call.response_format ? { response_format: convert_response_format(call.response_format) } : {}),
    ...(input.reasoning ? { reasoning_effort: input.reasoning.effort } : {}),
  };
}

/** 将一条 Downcity 消息转换为一个或多个上游消息。 */
function convert_message(message: ModelMessage): Record<string, unknown>[] {
  if (message.role === "tool") {
    return message.content
      .filter((part) => part.type === "tool_result")
      .map((part) => ({
        role: "tool",
        tool_call_id: part.tool_call_id,
        name: part.tool_name,
        content: stringify_tool_result(part.content),
      }));
  }
  if (message.role === "assistant") {
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
    const tool_calls = message.content
      .filter((part) => part.type === "tool_call")
      .map((part) => ({
        id: part.tool_call_id,
        type: "function",
        function: { name: part.tool_name, arguments: JSON.stringify(part.input) },
      }));
    return [{
      role: "assistant",
      content: text || null,
      ...(tool_calls.length ? { tool_calls } : {}),
    }];
  }
  if (message.role === "system") {
    return [{
      role: "system",
      content: message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
    }];
  }
  return [{ role: "user", content: message.content.map(convert_user_content) }];
}

/** 将用户内容转换为上游多模态内容。 */
function convert_user_content(part: ModelContent): Record<string, unknown> {
  if (part.type === "text") return { type: "text", text: part.text };
  if (part.type === "file") return convert_file_content(part);
  throw new Error(`User message contains unsupported content: ${part.type}`);
}

/** 将文件内容转换为 OpenAI-compatible 图片或文件 part。 */
function convert_file_content(part: ModelFileContent): Record<string, unknown> {
  const url = part.source.type === "url"
    ? part.source.url
    : `data:${part.media_type};base64,${part.source.data}`;
  if (part.media_type.startsWith("image/")) {
    return { type: "image_url", image_url: { url } };
  }
  return {
    type: "file",
    file: {
      file_data: url,
      ...(part.filename ? { filename: part.filename } : {}),
    },
  };
}

/** 将 Downcity 工具选择策略转换为 OpenAI-compatible 形态。 */
function convert_tool_choice(choice: ModelToolChoice): unknown {
  if (choice.type === "tool") {
    return { type: "function", function: { name: choice.tool_name } };
  }
  return choice.type;
}

/** 将响应格式转换为 OpenAI-compatible 形态。 */
function convert_response_format(format: NonNullable<AIChannelStreamInput["call"]["response_format"]>): unknown {
  if (format.type === "text") return { type: "text" };
  if (format.type === "json") return { type: "json_object" };
  return {
    type: "json_schema",
    json_schema: {
      name: format.name,
      schema: format.schema,
      ...(format.description ? { description: format.description } : {}),
      strict: true,
    },
  };
}

/** 将工具结果内容转为上游接受的字符串。 */
function stringify_tool_result(parts: ModelToolResultPart[]): string {
  if (parts.length === 1 && parts[0]?.type === "text") return parts[0].text;
  return JSON.stringify(parts.map((part) => part.type === "json" ? part.value : part));
}

/** 创建逐块解析上游 SSE 的标准事件流。 */
function create_event_stream(
  body: ReadableStream<Uint8Array>,
  identity: { request_id: string; model_id: string },
): ReadableStream<ModelStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  return new ReadableStream<ModelStreamEvent>({
    async start(controller) {
      const state = new OpenAIStreamState(controller);
      controller.enqueue({ type: "model_start", ...identity });
      let buffer = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const parsed = consume_sse_events(buffer);
          buffer = parsed.rest;
          for (const data of parsed.data) {
            if (data === "[DONE]") continue;
            state.accept(JSON.parse(data) as unknown);
          }
        }
        buffer += decoder.decode();
        for (const data of consume_sse_events(`${buffer}\n\n`).data) {
          if (data !== "[DONE]") state.accept(JSON.parse(data) as unknown);
        }
        state.finish();
        controller.close();
      } catch (error) {
        controller.enqueue({
          type: "model_error",
          error: {
            code: input_cancelled(error) ? "cancelled" : "provider_error",
            message: normalize_stream_error_message(error),
            retryable: !input_cancelled(error),
          },
        });
        controller.close();
      } finally {
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}

/** OpenAI SSE 到 Downcity 事件的有状态投影器。 */
class OpenAIStreamState {
  private text_started = false;
  private reasoning_started = false;
  private finish_reason?: ModelFinishReason;
  private finished = false;
  private usage_received = false;
  private readonly tool_calls = new Map<number, {
    content_id: string;
    tool_call_id: string;
    tool_name: string;
    input_text: string;
    started: boolean;
  }>();

  constructor(private readonly controller: ReadableStreamDefaultController<ModelStreamEvent>) {}

  /** 消费一个上游 JSON chunk。 */
  accept(value: unknown): void {
    const record = as_record(value);
    const usage = read_usage(record.usage);
    if (usage) {
      this.usage_received = true;
      this.controller.enqueue({ type: "model_usage", usage });
    }
    const choice = Array.isArray(record.choices) ? as_record(record.choices[0]) : {};
    const delta = as_record(choice.delta);
    const reasoning = read_string(delta.reasoning_content) || read_string(delta.reasoning);
    if (reasoning) {
      if (!this.reasoning_started) {
        this.reasoning_started = true;
        this.controller.enqueue({ type: "reasoning_start", content_id: "reasoning_1" });
      }
      this.controller.enqueue({ type: "reasoning_delta", content_id: "reasoning_1", delta: reasoning });
    }
    const text = read_string(delta.content);
    if (text) {
      if (!this.text_started) {
        this.text_started = true;
        this.controller.enqueue({ type: "text_start", content_id: "text_1" });
      }
      this.controller.enqueue({ type: "text_delta", content_id: "text_1", delta: text });
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const item of delta.tool_calls) this.accept_tool_call(as_record(item));
    }
    const finish_reason = read_finish_reason(choice.finish_reason);
    if (finish_reason) this.finish_reason = finish_reason;
  }

  /** 收口全部内容块和模型执行。 */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (!this.usage_received) throw new Error("OpenAI-compatible provider did not return usage");
    if (this.reasoning_started) {
      this.controller.enqueue({ type: "reasoning_finish", content_id: "reasoning_1" });
    }
    if (this.text_started) this.controller.enqueue({ type: "text_finish", content_id: "text_1" });
    for (const tool of this.tool_calls.values()) {
      if (!tool.started) throw new Error("OpenAI-compatible provider returned a tool call without a name");
      const parsed_input = parse_tool_input(tool.input_text);
      this.controller.enqueue({
        type: "tool_call_finish",
        content_id: tool.content_id,
        input: parsed_input.input,
        ...(parsed_input.error ? { input_error: parsed_input.error } : {}),
      });
    }
    this.controller.enqueue({ type: "model_finish", finish_reason: this.finish_reason ?? "unknown" });
  }

  /** 消费工具调用参数增量。 */
  private accept_tool_call(item: Record<string, unknown>): void {
    const index = typeof item.index === "number" ? item.index : 0;
    const fn = as_record(item.function);
    let tool = this.tool_calls.get(index);
    if (!tool) {
      const tool_call_id = read_string(item.id) || `call_${crypto.randomUUID()}`;
      tool = {
        content_id: `tool_${index + 1}`,
        tool_call_id,
        tool_name: "",
        input_text: "",
        started: false,
      };
      this.tool_calls.set(index, tool);
    }
    const tool_name_delta = read_string(fn.name);
    if (tool_name_delta) tool.tool_name += tool_name_delta;
    const input_delta = read_string(fn.arguments);
    if (input_delta) tool.input_text += input_delta;
    if (!tool.started && tool.tool_name) {
      tool.started = true;
      this.controller.enqueue({
        type: "tool_call_start",
        content_id: tool.content_id,
        tool_call_id: tool.tool_call_id,
        tool_name: tool.tool_name,
      });
      if (tool.input_text) {
        this.controller.enqueue({
          type: "tool_call_delta",
          content_id: tool.content_id,
          input_delta: tool.input_text,
        });
      }
      return;
    }
    if (tool.started && input_delta) {
      this.controller.enqueue({ type: "tool_call_delta", content_id: tool.content_id, input_delta });
    }
  }
}

/** 按 SSE 空行边界消费完整 data 事件。 */
function consume_sse_events(buffer: string): { data: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/gu, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  return {
    data: blocks
      .map((block) => block.split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n"))
      .filter(Boolean),
    rest,
  };
}

/** 解析标准累计 usage。 */
function read_usage(value: unknown): ModelUsage | undefined {
  const record = as_record(value);
  const input_tokens = read_number(record.prompt_tokens);
  const output_tokens = read_number(record.completion_tokens);
  if (input_tokens === undefined || output_tokens === undefined) return undefined;
  const details = as_record(record.prompt_tokens_details);
  const output_details = as_record(record.completion_tokens_details);
  return {
    input_tokens,
    output_tokens,
    total_tokens: input_tokens + output_tokens,
    ...(read_number(details.cached_tokens) !== undefined
      ? { cached_input_tokens: read_number(details.cached_tokens) }
      : {}),
    ...(read_number(output_details.reasoning_tokens) !== undefined
      ? { reasoning_tokens: read_number(output_details.reasoning_tokens) }
      : {}),
  };
}

/** 解析上游完成原因。 */
function read_finish_reason(value: unknown): ModelFinishReason | undefined {
  if (typeof value !== "string" || !value) return undefined;
  if (value === "stop") return "stop";
  if (value === "length") return "length";
  if (value === "tool_calls" || value === "function_call") return "tool_call";
  if (value === "content_filter") return "content_filter";
  return "unknown";
}

/** 解析完整工具输入 JSON。 */
function parse_tool_input(value: string): { input: ModelJsonValue; error?: string } {
  if (!value.trim()) return { input: {} };
  try {
    return { input: JSON.parse(value) as ModelJsonValue };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      input: {},
      error: `Tool call arguments are invalid JSON: ${message}`,
    };
  }
}

/** 创建不泄漏上游正文的边界错误。 */
async function create_upstream_error(response: Response): Promise<Error> {
  let message = response.statusText || `HTTP ${response.status}`;
  try {
    const body = as_record(await response.json());
    const error = as_record(body.error);
    message = read_string(error.message) || read_string(body.message) || message;
  } catch {
    // 上游非 JSON 错误响应只使用状态信息，避免回传未知正文。
  }
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = response.status;
  return error;
}

/** 判断异常是否来自取消。 */
function input_cancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** 将 Node fetch 的底层连接错误转换成可操作且不依赖运行时实现的说明。 */
function normalize_stream_error_message(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.trim().toLowerCase() === "terminated") {
    return "Model provider stream terminated before completion";
  }
  return message || "Model provider stream failed";
}

/** 将未知值安全收敛为普通对象。 */
function as_record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** 读取字符串字段。 */
function read_string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 读取有限数字字段。 */
function read_number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 移除 URL 尾部斜杠。 */
function trim_trailing_slash(value: string): string {
  return value.replace(/\/+$/u, "");
}
