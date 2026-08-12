/**
 * OpenAI Chat Completions 与 AI SDK LanguageModelV3 的协议适配模块。
 *
 * 本模块只负责 HTTP 协议转换，不负责模型选择、fallback、reasoning 策略、
 * providerOptions 或计费。所有请求在进入 AIChannel 前都已变为标准 V3 call。
 */

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "../../types/AI.js";
import type {
  AIStreamCompletion,
  OpenAIChatCompletionRequest,
  OpenAIChatContentPart,
  OpenAIChatMessage,
  OpenAIChatResponseFormat,
  OpenAIChatTool,
  OpenAIChatToolChoice,
  OpenAIChatUsage,
} from "../../types/AITransport.js";
import { collect_city_language_model_stream } from "../../utils/CityLanguageModelResult.js";

/** OpenAI SSE 响应头。 */
const OPENAI_SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
} as const;

/** 将 OpenAI Chat Completions 请求转换为标准 LanguageModelV3 调用参数。 */
export function openai_chat_request_to_language_model_call(
  request: OpenAIChatCompletionRequest,
  signal?: AbortSignal,
): LanguageModelV3CallOptions {
  if (!Array.isArray(request.messages)) {
    throw create_request_error("messages must be an array");
  }
  const max_output_tokens = read_optional_number(
    request.max_completion_tokens ?? request.max_tokens,
  );
  const stop_sequences = typeof request.stop === "string"
    ? [request.stop]
    : Array.isArray(request.stop)
      ? request.stop.filter((item): item is string => typeof item === "string")
      : undefined;
  const tools = convert_tools(request.tools);
  const tool_choice = convert_tool_choice(request.tool_choice);
  const response_format = convert_response_format(request.response_format);

  return {
    prompt: convert_messages(request.messages),
    ...(max_output_tokens !== undefined ? { maxOutputTokens: max_output_tokens } : {}),
    ...(read_optional_number(request.temperature) !== undefined
      ? { temperature: read_optional_number(request.temperature) }
      : {}),
    ...(read_optional_number(request.top_p) !== undefined
      ? { topP: read_optional_number(request.top_p) }
      : {}),
    ...(stop_sequences?.length ? { stopSequences: stop_sequences } : {}),
    ...(read_optional_number(request.presence_penalty) !== undefined
      ? { presencePenalty: read_optional_number(request.presence_penalty) }
      : {}),
    ...(read_optional_number(request.frequency_penalty) !== undefined
      ? { frequencyPenalty: read_optional_number(request.frequency_penalty) }
      : {}),
    ...(Number.isInteger(request.seed) ? { seed: request.seed } : {}),
    ...(tools?.length ? { tools } : {}),
    ...(tool_choice ? { toolChoice: tool_choice } : {}),
    ...(response_format ? { responseFormat: response_format } : {}),
    ...(signal ? { abortSignal: signal } : {}),
  } as LanguageModelV3CallOptions;
}

/** 把标准 V3 流输出转换成 OpenAI JSON 或 SSE Response。 */
export async function create_openai_chat_completion_response(input: {
  /** Federation 对外模型 ID。 */
  model_id: string;
  /** 是否返回 SSE。 */
  stream: boolean;
  /** AIChannel 返回的标准 V3 流。 */
  result: LanguageModelV3StreamResult;
}): Promise<{ response: Response; completion: Promise<AIStreamCompletion<LanguageModelV3GenerateResult>> }> {
  if (input.stream) return create_stream_response(input.model_id, input.result);
  const completion = collect_city_language_model_stream(
    input.result.stream,
    input.result.request?.body,
  );
  const result = await completion;
  return {
    response: Response.json(create_json_response(input.model_id, result)),
    completion: Promise.resolve({ outcome: "succeeded", result }),
  };
}

/** 创建非流式 OpenAI Chat Completion JSON。 */
function create_json_response(
  model_id: string,
  result: LanguageModelV3GenerateResult,
): Record<string, unknown> {
  const metadata = result.response;
  const tool_calls = result.content
    .filter((part) => part.type === "tool-call")
    .map((part) => ({
      id: part.toolCallId,
      type: "function",
      function: {
        name: part.toolName,
        arguments: serialize_tool_input(part.input),
      },
    }));
  const content = result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  const reasoning_content = result.content
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text)
    .join("");
  return {
    id: metadata?.id ?? `chatcmpl_${crypto.randomUUID()}`,
    object: "chat.completion",
    created: to_unix_timestamp(metadata?.timestamp),
    model: model_id,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: content || null,
        ...(reasoning_content ? { reasoning_content } : {}),
        ...(tool_calls.length ? { tool_calls } : {}),
      },
      finish_reason: to_openai_finish_reason(result.finishReason),
    }],
    usage: to_openai_usage(result.usage),
  };
}

/** 创建 OpenAI Chat Completions SSE，并在消费过程中聚合计费所需结果。 */
function create_stream_response(
  model_id: string,
  result: LanguageModelV3StreamResult,
): { response: Response; completion: Promise<AIStreamCompletion<LanguageModelV3GenerateResult>> } {
  const reader = result.stream.getReader();
  const encoder = new TextEncoder();
  const response_id = `chatcmpl_${crypto.randomUUID()}`;
  let resolved_response_id = response_id;
  let created = Math.floor(Date.now() / 1000);
  let resolve_completion: (value: AIStreamCompletion<LanguageModelV3GenerateResult>) => void = () => undefined;
  const completion = new Promise<AIStreamCompletion<LanguageModelV3GenerateResult>>((resolve) => {
    resolve_completion = resolve;
  });
  const collected_parts: LanguageModelV3StreamPart[] = [];
  const tool_indexes = new Map<string, number>();
  const streamed_tool_ids = new Set<string>();
  let next_tool_index = 0;
  let completed = false;
  let sent_role = false;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) {
            await complete_stream();
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }
          const part = chunk.value;
          collected_parts.push(part);
          if (part.type === "response-metadata") {
            if (part.id) resolved_response_id = part.id;
            created = to_unix_timestamp(part.timestamp);
          }
          if (part.type === "finish") {
            if (!sent_role) {
              sent_role = true;
              controller.enqueue(encoder.encode(serialize_sse_chunk({
                delta: { role: "assistant" },
              })));
            }
            controller.enqueue(encoder.encode(serialize_sse_chunk({
              delta: {},
              finish_reason: to_openai_finish_reason(part.finishReason),
              usage: to_openai_usage(part.usage),
            })));
            return;
          }
          const payloads = stream_part_to_openai_chunks(part, {
            get_tool_index: (tool_call_id) => {
              const existing = tool_indexes.get(tool_call_id);
              if (existing !== undefined) return existing;
              const index = next_tool_index;
              next_tool_index += 1;
              tool_indexes.set(tool_call_id, index);
              return index;
            },
            streamed_tool_ids,
          });
          if (!sent_role && payloads.length > 0) {
            sent_role = true;
            payloads.unshift({ role: "assistant" });
          }
          if (payloads.length === 0) continue;
          for (const delta of payloads) {
            controller.enqueue(encoder.encode(serialize_sse_chunk({ delta })));
          }
          return;
        }
      } catch (error) {
        complete({ outcome: "failed", error });
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      complete({ outcome: "cancelled" });
    },
  });

  return {
    response: new Response(body, { status: 200, headers: OPENAI_SSE_HEADERS }),
    completion,
  };

  /** 序列化一个 OpenAI chunk。 */
  function serialize_sse_chunk(input: {
    delta: Record<string, unknown>;
    finish_reason?: string | null;
    usage?: OpenAIChatUsage;
  }): string {
    return `data: ${JSON.stringify({
      id: resolved_response_id,
      object: "chat.completion.chunk",
      created,
      model: model_id,
      choices: [{
        index: 0,
        delta: input.delta,
        finish_reason: input.finish_reason ?? null,
      }],
      ...(input.usage ? { usage: input.usage } : {}),
    })}\n\n`;
  }

  /** 在上游结束时输出 finish chunk 并构造标准聚合结果。 */
  async function complete_stream(): Promise<void> {
    const replay = new ReadableStream<LanguageModelV3StreamPart>({
      start(replay_controller) {
        for (const part of collected_parts) replay_controller.enqueue(part);
        replay_controller.close();
      },
    });
    try {
      complete({
        outcome: "succeeded",
        result: await collect_city_language_model_stream(replay, result.request?.body),
      });
    } catch (error) {
      complete({ outcome: "failed", error });
    }
  }

  /** 只结算一次 completion。 */
  function complete(value: AIStreamCompletion<LanguageModelV3GenerateResult>): void {
    if (completed) return;
    completed = true;
    resolve_completion(value);
  }
}

/** 将一个 V3 流事件转换成零个或多个 OpenAI delta。 */
function stream_part_to_openai_chunks(
  part: LanguageModelV3StreamPart,
  state: {
    /** 为一个工具调用分配稳定的 OpenAI choice index。 */
    get_tool_index: (tool_call_id: string) => number;
    /** 已经输出过增量参数的工具调用 ID。 */
    streamed_tool_ids: Set<string>;
  },
): Record<string, unknown>[] {
  if (part.type === "text-delta") return [{ content: part.delta }];
  if (part.type === "reasoning-delta") return [{ reasoning_content: part.delta }];
  if (part.type === "tool-input-start") {
    state.streamed_tool_ids.add(part.id);
    return [{
      tool_calls: [{
        index: state.get_tool_index(part.id),
        id: part.id,
        type: "function",
        function: { name: part.toolName, arguments: "" },
      }],
    }];
  }
  if (part.type === "tool-input-delta") {
    state.streamed_tool_ids.add(part.id);
    return [{
      tool_calls: [{
        index: state.get_tool_index(part.id),
        id: part.id,
        function: { arguments: part.delta },
      }],
    }];
  }
  if (part.type === "tool-call") {
    if (state.streamed_tool_ids.has(part.toolCallId)) return [];
    return [{
      tool_calls: [{
        index: state.get_tool_index(part.toolCallId),
        id: part.toolCallId,
        type: "function",
        function: {
          name: part.toolName,
          arguments: serialize_tool_input(part.input),
        },
      }],
    }];
  }
  if (part.type === "error") throw part.error;
  return [];
}

/** 将 OpenAI 消息列表转换成标准 V3 prompt。 */
function convert_messages(messages: OpenAIChatMessage[]): LanguageModelV3CallOptions["prompt"] {
  const prompt: Array<Record<string, unknown>> = [];
  const tool_names = new Map<string, string>();
  for (const message of messages) {
    if (!message || typeof message !== "object") throw create_request_error("message must be an object");
    if (message.role === "system" || message.role === "developer") {
      prompt.push({ role: "system", content: read_text_content(message.content) });
      continue;
    }
    if (message.role === "user") {
      prompt.push({ role: "user", content: convert_user_content(message.content) });
      continue;
    }
    if (message.role === "assistant") {
      const content: Array<Record<string, unknown>> = [];
      if (Array.isArray(message.content)) {
        content.push(...convert_user_content(message.content));
      } else {
        const text = read_optional_text_content(message.content);
        if (text) content.push({ type: "text", text });
      }
      for (const tool_call of message.tool_calls ?? []) {
        tool_names.set(tool_call.id, tool_call.function.name);
        content.push({
          type: "tool-call",
          toolCallId: tool_call.id,
          toolName: tool_call.function.name,
          input: parse_json_or_text(tool_call.function.arguments),
        });
      }
      prompt.push({ role: "assistant", content });
      continue;
    }
    if (message.role === "tool") {
      const tool_call_id = read_required_string(message.tool_call_id, "tool_call_id");
      prompt.push({
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: tool_call_id,
          toolName: message.name ?? tool_names.get(tool_call_id) ?? "tool",
          output: create_tool_output(message.content),
        }],
      });
      continue;
    }
    throw create_request_error(`unsupported message role: ${String(message.role)}`);
  }
  return prompt as LanguageModelV3CallOptions["prompt"];
}

/** 转换 user 的文本、图片和文件内容。 */
function convert_user_content(content: OpenAIChatMessage["content"]): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (content == null) return [];
  if (!Array.isArray(content)) throw create_request_error("message content must be a string or array");
  return content.map((part) => convert_user_part(part));
}

/** 转换单个 OpenAI user content part。 */
function convert_user_part(part: OpenAIChatContentPart): Record<string, unknown> {
  if (part.type === "text" || part.type === "input_text") {
    return { type: "text", text: read_required_string(part.text, "content.text") };
  }
  if (part.type === "image_url" || part.type === "input_image") {
    const url = part.url ?? part.image_url?.url;
    return {
      type: "file",
      data: to_url_or_data(read_required_string(url, "content.image_url.url")),
      mediaType: infer_media_type(url, "image/*"),
    };
  }
  if (part.type === "file") {
    return {
      type: "file",
      data: to_url_or_data(read_required_string(part.url, "content.url")),
      mediaType: part.media_type ?? part.mediaType ?? infer_media_type(part.url, "application/octet-stream"),
      ...(part.filename ? { filename: part.filename } : {}),
    };
  }
  throw create_request_error(`unsupported content type: ${String((part as { type?: unknown }).type)}`);
}

/** 转换 OpenAI function tools。 */
function convert_tools(tools: OpenAIChatTool[] | undefined): LanguageModelV3CallOptions["tools"] {
  if (!tools) return undefined;
  return tools.map((tool) => {
    if (tool.type !== "function" || !tool.function?.name) {
      throw create_request_error("only named function tools are supported");
    }
    return {
      type: "function",
      name: tool.function.name,
      ...(tool.function.description ? { description: tool.function.description } : {}),
      inputSchema: tool.function.parameters ?? {},
      ...(tool.function.strict !== undefined ? { strict: tool.function.strict } : {}),
    };
  }) as LanguageModelV3CallOptions["tools"];
}

/** 转换 OpenAI tool_choice。 */
function convert_tool_choice(
  choice: OpenAIChatToolChoice | undefined,
): LanguageModelV3CallOptions["toolChoice"] {
  if (!choice) return undefined;
  if (typeof choice === "string") return { type: choice };
  const tool_name = choice.function?.name;
  if (!tool_name) throw create_request_error("tool_choice.function.name is required");
  return { type: "tool", toolName: tool_name };
}

/** 转换 OpenAI response_format。 */
function convert_response_format(
  format: OpenAIChatResponseFormat | undefined,
): LanguageModelV3CallOptions["responseFormat"] {
  if (!format || format.type === "text") return format ? { type: "text" } : undefined;
  if (format.type === "json_object") return { type: "json" };
  return {
    type: "json",
    name: format.json_schema.name,
    ...(format.json_schema.description ? { description: format.json_schema.description } : {}),
    schema: format.json_schema.schema,
  } as LanguageModelV3CallOptions["responseFormat"];
}

/** 将 V3 finish reason 映射为 OpenAI finish_reason。 */
function to_openai_finish_reason(reason: LanguageModelV3GenerateResult["finishReason"]): string {
  const unified = reason.unified;
  if (unified === "stop") return "stop";
  if (unified === "length") return "length";
  if (unified === "tool-calls") return "tool_calls";
  if (unified === "content-filter") return "content_filter";
  return "stop";
}

/** 将 V3 usage 映射为 OpenAI usage。 */
function to_openai_usage(usage: LanguageModelV3GenerateResult["usage"]): OpenAIChatUsage {
  const prompt_tokens = usage.inputTokens.total ?? 0;
  const completion_tokens = usage.outputTokens.total ?? 0;
  const cached_tokens = usage.inputTokens.cacheRead ?? 0;
  const reasoning_tokens = usage.outputTokens.reasoning ?? 0;
  return {
    prompt_tokens,
    completion_tokens,
    total_tokens: prompt_tokens + completion_tokens,
    ...(cached_tokens > 0 ? { prompt_tokens_details: { cached_tokens } } : {}),
    ...(reasoning_tokens > 0 ? { completion_tokens_details: { reasoning_tokens } } : {}),
  };
}

/** 将工具输入稳定序列化为 JSON 字符串。 */
function serialize_tool_input(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return "{}";
  }
}

/** 将 JSON 字符串解析为工具输入，非法 JSON 保留为文本。 */
function parse_json_or_text(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return input;
  }
}

/** 构造标准 V3 tool result output。 */
function create_tool_output(content: OpenAIChatMessage["content"]): Record<string, unknown> {
  const value = read_text_content(content);
  try {
    return { type: "json", value: JSON.parse(value) as unknown };
  } catch {
    return { type: "text", value };
  }
}

/** 从消息内容读取纯文本。 */
function read_text_content(content: OpenAIChatMessage["content"]): string {
  return read_optional_text_content(content) ?? "";
}

/** 从消息内容读取可选纯文本。 */
function read_optional_text_content(content: OpenAIChatMessage["content"]): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((part): part is Extract<OpenAIChatContentPart, { type: "text" | "input_text" }> =>
      part.type === "text" || part.type === "input_text")
    .map((part) => part.text)
    .join("\n");
  return text || undefined;
}

/** HTTP URL 转成 URL 对象，Data URL 保持字符串。 */
function to_url_or_data(value: string): URL | string {
  return /^https?:\/\//iu.test(value) ? new URL(value) : value;
}

/** 从 Data URL 推断媒体类型，普通 URL 使用 fallback。 */
function infer_media_type(value: string | undefined, fallback: string): string {
  const match = value?.match(/^data:([^;,]+)[;,]/iu);
  return match?.[1] ?? fallback;
}

/** 把 Date 转换成 OpenAI Unix 秒级时间戳。 */
function to_unix_timestamp(value: Date | undefined): number {
  return value ? Math.floor(value.getTime() / 1000) : Math.floor(Date.now() / 1000);
}

/** 读取有限数字。 */
function read_optional_number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 读取必填字符串。 */
function read_required_string(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw create_request_error(`${field} is required`);
  return value;
}

/** 创建会映射为 HTTP 422 的请求错误。 */
function create_request_error(message: string): Error {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 422;
  return error;
}
