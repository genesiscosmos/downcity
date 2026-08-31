/**
 * Federation Downcity Model Protocol transport 模块。
 *
 * 该模块负责请求边界校验与 SSE 编码，不拥有模型路由、Provider 执行或计费策略。
 */

import {
  MODEL_PROTOCOL_VERSION,
  ModelStreamValidator,
  type ModelCall,
  type ModelContent,
  type ModelMessage,
  type ModelStreamEnvelope,
  type ModelStreamEvent,
  type ModelUsage,
} from "@downcity/type";
import type {
  AIStreamCompletion,
  CityLanguageModelStreamExecution,
  CreateCityLanguageModelStreamInput,
  DecodedCityLanguageModelRequest,
  ModelStreamCompletionResult,
  RawCityLanguageModelRequest,
} from "../../types/AITransport.js";

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
} as const;

/** 校验并解码 Downcity Model Protocol 请求。 */
export function decode_city_language_model_request(
  input: RawCityLanguageModelRequest,
): DecodedCityLanguageModelRequest {
  if (!is_record(input)) throw create_protocol_error("request must be an object");
  assert_only_fields(input, ["protocol_version", "model_id", "call"], "request");
  if (input.protocol_version !== MODEL_PROTOCOL_VERSION) {
    throw create_protocol_error(`Unsupported Downcity model protocol: ${String(input.protocol_version)}`);
  }
  const model_id = read_required_string(input.model_id, "model_id");
  if (!is_record(input.call)) throw create_protocol_error("call must be an object");
  const call = input.call as unknown as ModelCall;
  validate_call(call);
  if (!Array.isArray(call.messages)) throw create_protocol_error("call.messages must be an array");
  call.messages.forEach(validate_message);
  const tool_names = validate_tools(call.tools);
  validate_tool_choice(call.tool_choice, tool_names);
  return { model_id, call };
}
/** Downcity ModelCall 已经是安全 JSON 协议，无需清理第三方私有字段。 */
export function prepare_city_language_model_call(call: ModelCall): ModelCall {
  return call;
}

/** 将标准 Downcity 模型事件流编码为 SSE。 */
export function create_city_language_model_stream(
  input: CreateCityLanguageModelStreamInput,
): CityLanguageModelStreamExecution {
  const reader = input.stream.getReader();
  const encoder = new TextEncoder();
  const validator = new ModelStreamValidator();
  let terminal_event: Extract<ModelStreamEvent, { type: "model_finish" | "model_error" }> | undefined;
  let final_usage: ModelUsage | undefined;
  let completed = false;
  let resolve_completion: (
    result: AIStreamCompletion<ModelStreamCompletionResult>,
  ) => void = () => undefined;
  const completion = new Promise<AIStreamCompletion<ModelStreamCompletionResult>>((resolve) => {
    resolve_completion = resolve;
  });

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          validator.finish();
          if (!terminal_event || !final_usage) {
            throw new Error("Model stream ended without final usage and terminal event");
          }
          const result = { usage: final_usage, terminal_event };
          complete(terminal_event.type === "model_finish"
            ? { outcome: "succeeded", result }
            : {
                outcome: "failed",
                result,
                error: new Error(terminal_event.error.message),
              });
          controller.close();
          return;
        }
        validator.accept(chunk.value);
        if (chunk.value.type === "model_usage") final_usage = chunk.value.usage;
        if (is_terminal_event(chunk.value)) terminal_event = chunk.value;
        controller.enqueue(encoder.encode(serialize_stream_event(chunk.value)));
      } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        const result = terminal_event && final_usage
          ? { usage: final_usage, terminal_event }
          : undefined;
        complete({ outcome: "failed", ...(result ? { result } : {}), error });
        controller.close();
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        const result = terminal_event && final_usage
          ? { usage: final_usage, terminal_event }
          : undefined;
        complete({ outcome: "cancelled", ...(result ? { result } : {}) });
      }
    },
  });

  return {
    response: new Response(body, { status: 200, headers: SSE_HEADERS }),
    completion,
  };

  function complete(
    result: AIStreamCompletion<ModelStreamCompletionResult>,
  ): void {
    if (completed) return;
    completed = true;
    resolve_completion(result);
  }
}

/** 把标准事件编码成单个版本化 SSE data。 */
function serialize_stream_event(event: ModelStreamEvent): string {
  const envelope: ModelStreamEnvelope = {
    protocol_version: MODEL_PROTOCOL_VERSION,
    event,
  };
  return `data: ${JSON.stringify(envelope)}\n\n`;
}

/** 校验消息的最小结构和角色。 */
function validate_message(message: ModelMessage, index: number): void {
  if (!is_record(message)) throw create_protocol_error(`call.messages[${index}] must be an object`);
  assert_only_fields(message, ["role", "content"], `call.messages[${index}]`);
  if (!["system", "user", "assistant", "tool"].includes(String(message.role))) {
    throw create_protocol_error(`call.messages[${index}].role is invalid`);
  }
  if (!Array.isArray(message.content) || message.content.length === 0) {
    throw create_protocol_error(`call.messages[${index}].content must be a non-empty array`);
  }
  message.content.forEach((content, content_index) => {
    validate_content(content, `call.messages[${index}].content[${content_index}]`);
    if (!role_accepts_content(message.role, content.type)) {
      throw create_protocol_error(
        `call.messages[${index}] role ${message.role} does not accept ${content.type}`,
      );
    }
  });
}

/** 校验判别式消息内容及其必填字段。 */
function validate_content(content: ModelContent, field: string): void {
  if (!is_record(content)) throw create_protocol_error(`${field} must be an object`);
  if (content.type === "text" || content.type === "reasoning") {
    assert_only_fields(
      content,
      content.type === "reasoning" ? ["type", "text", "signature"] : ["type", "text"],
      field,
    );
    read_required_string(content.text, `${field}.text`);
    if (content.type === "reasoning" && content.signature !== undefined) {
      read_required_string(content.signature, `${field}.signature`);
    }
    return;
  }
  if (content.type === "file") {
    assert_only_fields(content, ["type", "media_type", "source", "filename"], field);
    const media_type = read_required_string(content.media_type, `${field}.media_type`);
    if (!/^[^/\s]+\/[^/\s]+$/u.test(media_type)) {
      throw create_protocol_error(`${field}.media_type must be a valid MIME type`);
    }
    if (content.filename !== undefined) read_required_string(content.filename, `${field}.filename`);
    if (!is_record(content.source)) throw create_protocol_error(`${field}.source must be an object`);
    if (content.source.type === "url") {
      assert_only_fields(content.source, ["type", "url"], `${field}.source`);
      const url = read_required_string(content.source.url, `${field}.source.url`);
      let protocol = "";
      try {
        protocol = new URL(url).protocol;
      } catch {
        throw create_protocol_error(`${field}.source.url must be an absolute HTTP URL`);
      }
      if (protocol !== "http:" && protocol !== "https:") {
        throw create_protocol_error(`${field}.source.url must be an absolute HTTP URL`);
      }
      return;
    }
    if (content.source.type === "base64") {
      assert_only_fields(content.source, ["type", "data"], `${field}.source`);
      const data = read_required_string(content.source.data, `${field}.source.data`);
      if (data.startsWith("data:") || !/^[A-Za-z0-9+/]+={0,2}$/u.test(data)) {
        throw create_protocol_error(`${field}.source.data must be raw Base64`);
      }
      return;
    }
    throw create_protocol_error(`${field}.source.type is invalid`);
  }
  if (content.type === "tool_call") {
    assert_only_fields(content, ["type", "tool_call_id", "tool_name", "input"], field);
    read_required_string(content.tool_call_id, `${field}.tool_call_id`);
    read_required_string(content.tool_name, `${field}.tool_name`);
    validate_json_value(content.input, `${field}.input`);
    return;
  }
  if (content.type === "tool_result") {
    assert_only_fields(
      content,
      ["type", "tool_call_id", "tool_name", "outcome", "content"],
      field,
    );
    read_required_string(content.tool_call_id, `${field}.tool_call_id`);
    read_required_string(content.tool_name, `${field}.tool_name`);
    if (content.outcome !== "succeeded" && content.outcome !== "failed") {
      throw create_protocol_error(`${field}.outcome is invalid`);
    }
    if (!Array.isArray(content.content) || content.content.length === 0) {
      throw create_protocol_error(`${field}.content must be a non-empty array`);
    }
    content.content.forEach((part, index) => {
      if (part.type === "json") {
        assert_only_fields(part, ["type", "value"], `${field}.content[${index}]`);
        validate_json_value(part.value, `${field}.content[${index}].value`);
      }
      else validate_content(part, `${field}.content[${index}]`);
    });
    return;
  }
  throw create_protocol_error(`${field}.type is invalid`);
}

/** 校验角色允许的封闭内容集合。 */
function role_accepts_content(role: ModelMessage["role"], type: ModelContent["type"]): boolean {
  if (role === "system") return type === "text";
  if (role === "user") return type === "text" || type === "file";
  if (role === "assistant") return type === "text" || type === "reasoning" || type === "tool_call";
  return type === "tool_result";
}

/** 校验工具定义的最小传输契约。 */
function validate_tools(tools: ModelCall["tools"]): Set<string> {
  if (tools === undefined) return new Set();
  if (!Array.isArray(tools)) throw create_protocol_error("call.tools must be an array");
  const names = new Set<string>();
  tools.forEach((tool, index) => {
    if (!is_record(tool)) throw create_protocol_error(`call.tools[${index}] must be an object`);
    assert_only_fields(tool, ["name", "description", "input_schema"], `call.tools[${index}]`);
    const name = read_required_string(tool.name, `call.tools[${index}].name`);
    if (names.has(name)) throw create_protocol_error(`call.tools contains duplicate name: ${name}`);
    names.add(name);
    if (typeof tool.description !== "string") {
      throw create_protocol_error(`call.tools[${index}].description must be a string`);
    }
    if (!is_record(tool.input_schema)) {
      throw create_protocol_error(`call.tools[${index}].input_schema must be an object`);
    }
    validate_json_value(tool.input_schema, `call.tools[${index}].input_schema`);
  });
  return names;
}

/** 校验 ModelCall 自身的封闭参数集合。 */
function validate_call(call: ModelCall): void {
  assert_only_fields(call, [
    "messages",
    "tools",
    "tool_choice",
    "max_output_tokens",
    "temperature",
    "top_p",
    "top_k",
    "presence_penalty",
    "frequency_penalty",
    "stop_sequences",
    "seed",
    "reasoning",
    "response_format",
  ], "call");
  if (call.max_output_tokens !== undefined &&
    (!Number.isSafeInteger(call.max_output_tokens) || call.max_output_tokens <= 0)) {
    throw create_protocol_error("call.max_output_tokens must be a positive integer");
  }
  for (const field of ["temperature", "presence_penalty", "frequency_penalty"] as const) {
    const value = call[field];
    if (value !== undefined && !Number.isFinite(value)) {
      throw create_protocol_error(`call.${field} must be finite`);
    }
  }
  if (call.top_p !== undefined &&
    (!Number.isFinite(call.top_p) || call.top_p < 0 || call.top_p > 1)) {
    throw create_protocol_error("call.top_p must be between 0 and 1");
  }
  if (call.top_k !== undefined && (!Number.isSafeInteger(call.top_k) || call.top_k <= 0)) {
    throw create_protocol_error("call.top_k must be a positive integer");
  }
  if (call.seed !== undefined && !Number.isSafeInteger(call.seed)) {
    throw create_protocol_error("call.seed must be an integer");
  }
  if (call.stop_sequences !== undefined) {
    if (!Array.isArray(call.stop_sequences) || call.stop_sequences.length === 0) {
      throw create_protocol_error("call.stop_sequences must be a non-empty array");
    }
    call.stop_sequences.forEach((value, index) =>
      read_required_string(value, `call.stop_sequences[${index}]`));
  }
  if (call.reasoning !== undefined) {
    if (!is_record(call.reasoning)) throw create_protocol_error("call.reasoning must be an object");
    assert_only_fields(call.reasoning, ["enabled", "effort"], "call.reasoning");
    if (typeof call.reasoning.enabled !== "boolean") {
      throw create_protocol_error("call.reasoning.enabled must be a boolean");
    }
    if (call.reasoning.effort !== undefined) {
      read_required_string(call.reasoning.effort, "call.reasoning.effort");
    }
  }
  validate_response_format(call.response_format);
}

/** 校验工具选择只引用本次调用真实存在的工具。 */
function validate_tool_choice(
  choice: ModelCall["tool_choice"],
  tool_names: Set<string>,
): void {
  if (choice === undefined) return;
  if (!is_record(choice)) throw create_protocol_error("call.tool_choice must be an object");
  if (!["auto", "none", "required", "tool"].includes(String(choice.type))) {
    throw create_protocol_error("call.tool_choice.type is invalid");
  }
  assert_only_fields(
    choice,
    choice.type === "tool" ? ["type", "tool_name"] : ["type"],
    "call.tool_choice",
  );
  if (choice.type === "tool") {
    const tool_name = read_required_string(choice.tool_name, "call.tool_choice.tool_name");
    if (!tool_names.has(tool_name)) {
      throw create_protocol_error(`call.tool_choice references unknown tool: ${tool_name}`);
    }
  } else if (choice.type !== "none" && tool_names.size === 0) {
    throw create_protocol_error("call.tool_choice requires at least one tool");
  }
}

/** 校验文本、JSON 与 JSON Schema 输出约束。 */
function validate_response_format(format: ModelCall["response_format"]): void {
  if (format === undefined) return;
  if (!is_record(format)) throw create_protocol_error("call.response_format must be an object");
  if (format.type === "text" || format.type === "json") {
    assert_only_fields(format, ["type"], "call.response_format");
    return;
  }
  if (format.type !== "json_schema") {
    throw create_protocol_error("call.response_format.type is invalid");
  }
  assert_only_fields(
    format,
    ["type", "name", "description", "schema"],
    "call.response_format",
  );
  read_required_string(format.name, "call.response_format.name");
  if (format.description !== undefined) {
    read_required_string(format.description, "call.response_format.description");
  }
  if (!is_record(format.schema)) {
    throw create_protocol_error("call.response_format.schema must be an object");
  }
  validate_json_value(format.schema, "call.response_format.schema");
}

/** 递归校验 JSON 可传输值。 */
function validate_json_value(value: unknown, field: string): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => validate_json_value(item, `${field}[${index}]`));
    return;
  }
  if (is_record(value)) {
    for (const [key, item] of Object.entries(value)) validate_json_value(item, `${field}.${key}`);
    return;
  }
  throw create_protocol_error(`${field} must be valid JSON`);
}

/** 判断事件是否为模型流终态。 */
function is_terminal_event(
  event: ModelStreamEvent,
): event is Extract<ModelStreamEvent, { type: "model_finish" | "model_error" }> {
  return event.type === "model_finish" || event.type === "model_error";
}

/** 判断输入是否为普通对象。 */
function is_record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** 拒绝 Downcity 协议对象中的未知或 Provider 私有字段。 */
function assert_only_fields(
  value: object,
  fields: readonly string[],
  path: string,
): void {
  const allowed = new Set(fields);
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown) throw create_protocol_error(`${path}.${unknown} is not supported`);
}

/** 读取必填非空字符串。 */
function read_required_string(value: unknown, field: string): string {
  const output = typeof value === "string" ? value.trim() : "";
  if (!output) throw create_protocol_error(`${field} is required`);
  return output;
}

/** 创建会被 Federation 映射为 422 的协议错误。 */
function create_protocol_error(message: string): Error {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 422;
  return error;
}
