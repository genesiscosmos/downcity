/**
 * City 客户端 UIMessage 流包装模块。
 *
 * Federation `/v1/ai/stream` 只返回标准 LanguageModelV3 流。该模块在客户端使用
 * AI SDK `streamText()` 将 CityModel 流转换为 `UIMessageChunk`，避免 UI 协议进入
 * Federation 或 CityModel transport 边界。
 */

import {
  convertToModelMessages,
  jsonSchema,
  streamText,
  tool,
  type ToolSet,
  type UIMessage,
} from "ai";
import type { UserServiceInput, UserStreamResult } from "../../user/types.js";
import type { UserModelRef } from "./types.js";

/** AI SDK `streamText()` 支持直接透传的公开生成参数。 */
const STREAM_OPTION_KEYS = [
  "maxOutputTokens",
  "temperature",
  "topP",
  "topK",
  "presencePenalty",
  "frequencyPenalty",
  "stopSequences",
  "seed",
  "toolChoice",
  "activeTools",
  "abortSignal",
] as const;

/**
 * 使用 CityModel 执行流式生成，并在客户端转换成 UIMessageChunk。
 */
export async function create_client_ui_stream(
  input: UserServiceInput,
  model: UserModelRef,
): Promise<UserStreamResult> {
  const tools = create_client_tool_set(input.tools);
  const messages = Array.isArray(input.messages)
    ? input.messages as UIMessage[]
    : undefined;
  const prompt = typeof input.prompt === "string" ? input.prompt : undefined;
  if (!messages?.length && prompt === undefined) {
    throw new TypeError("city.ai.stream() requires prompt or messages");
  }
  const reasoning_effort = read_reasoning_effort(input);

  const common_options = {
    model,
    ...(tools ? { tools } : {}),
    ...read_stream_options(input),
    ...(reasoning_effort
      ? {
          providerOptions: {
            downcity: { reasoningEffort: reasoning_effort },
          },
        }
      : {}),
  };

  if (messages?.length) {
    const model_messages = tools
      ? await convertToModelMessages(messages, { tools })
      : await convertToModelMessages(messages);
    const result = streamText({
      ...common_options,
      messages: model_messages,
    });
    return result.toUIMessageStream({ originalMessages: messages });
  }

  const result = streamText({
    ...common_options,
    prompt: prompt ?? "",
  });
  return result.toUIMessageStream();
}

/**
 * 将公开 stream 输入中的工具定义规范化为不带 execute 的 AI SDK ToolSet。
 *
 * `city.ai.stream()` 只负责一次模型流，不在 City SDK 内执行工具循环。
 */
function create_client_tool_set(value: unknown): ToolSet | undefined {
  const entries = Array.isArray(value)
    ? value.map((item) => [read_tool_name(undefined, item), item] as const)
    : value && typeof value === "object"
      ? Object.entries(value as Record<string, unknown>)
      : [];
  const tools = entries.flatMap(([fallback_name, definition]) => {
    const name = read_tool_name(fallback_name, definition);
    if (!name) return [];
    const record = read_record(definition);
    const function_record = read_record(record?.function);
    const description = read_optional_string(function_record?.description)
      ?? read_optional_string(record?.description)
      ?? "";
    const input_schema = function_record?.parameters
      ?? unwrap_json_schema(record?.inputSchema)
      ?? record?.parameters
      ?? {};
    return [[name, tool({
      description,
      inputSchema: jsonSchema(input_schema),
    })] as const];
  });
  return tools.length > 0 ? Object.fromEntries(tools) : undefined;
}

/** 读取 AI SDK 或 OpenAI function tool 的名称。 */
function read_tool_name(fallback_name: unknown, definition: unknown): string {
  const fallback = read_optional_string(fallback_name);
  if (fallback) return fallback;
  const record = read_record(definition);
  const direct_name = read_optional_string(record?.name);
  if (direct_name) return direct_name;
  return read_optional_string(read_record(record?.function)?.name) ?? "";
}

/** 展开 AI SDK jsonSchema 包装，得到可传输的 JSON Schema。 */
function unwrap_json_schema(value: unknown): unknown {
  const record = read_record(value);
  return record?.jsonSchema ?? value;
}

/** 只读取允许传给 AI SDK `streamText()` 的生成参数。 */
function read_stream_options(input: UserServiceInput): Record<string, unknown> {
  return Object.fromEntries(
    STREAM_OPTION_KEYS.flatMap((key) => input[key] === undefined ? [] : [[key, input[key]]]),
  );
}

/** 读取 Downcity 推理强度。 */
function read_reasoning_effort(input: UserServiceInput): string | undefined {
  return read_optional_string(input.reasoning_effort);
}

/** 将未知值收窄为普通对象。 */
function read_record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** 读取非空字符串。 */
function read_optional_string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
