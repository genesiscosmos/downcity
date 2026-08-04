/**
 * Federation City LanguageModel Transport 流模块。
 *
 * 负责请求协议校验、调用参数清理和 SSE 编码。模型执行、路由、reasoning、
 * 计费与鉴权仍由 AIChannel / AIService 负责。
 */

import {
  CITY_LANGUAGE_MODEL_PROTOCOL_V1,
  type CityLanguageModelStreamEventV1,
  type CityTransportJsonObject,
  type CityTransportJsonValue,
} from "../../types/AITransport.js";
import type {
  AIStreamCompletion,
  CityLanguageModelStreamExecution,
  CreateCityLanguageModelStreamInput,
  DecodedCityLanguageModelRequest,
  RawCityLanguageModelRequest,
} from "../../types/AITransport.js";
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from "../../types/AI.js";
import {
  decode_city_transport_value,
  encode_city_transport_object,
} from "../../utils/CityLanguageModelCodec.js";

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
} as const;

/** 校验并解码 CityModel transport 请求。 */
export function decode_city_language_model_request(
  input: RawCityLanguageModelRequest,
): DecodedCityLanguageModelRequest {
  if (input.protocol !== CITY_LANGUAGE_MODEL_PROTOCOL_V1) {
    throw create_protocol_error(`Unsupported City language model protocol: ${String(input.protocol)}`);
  }
  const model_id = read_required_string(input.model_id, "model_id");
  if (!is_json_object(input.call)) throw create_protocol_error("call must be a JSON object");
  const decoded = decode_city_transport_value(input.call as CityTransportJsonValue);
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw create_protocol_error("decoded call must be an object");
  }
  const call = decoded as LanguageModelV3CallOptions;
  if (!Array.isArray(call.prompt)) throw create_protocol_error("call.prompt must be an array");
  if (call.tools?.some((tool) => tool.type === "provider")) {
    throw create_protocol_error("AI SDK Provider-defined tools are not supported by City transport v1");
  }
  return {
    model_id,
    call,
    ...(read_optional_string(input.reasoning_effort)
      ? { reasoning_effort: read_optional_string(input.reasoning_effort) }
      : {}),
  };
}

/**
 * 清理客户端不能控制的调用字段，并绑定当前 HTTP 请求取消信号。
 *
 * 关键点（中文）
 * - 客户端 providerOptions 永远不会透传到上游。
 * - 上游私有运行策略只能来自 Federation 服务端的 AIChannel / Model 配置。
 */
export function prepare_city_language_model_call(
  call: LanguageModelV3CallOptions,
  signal?: AbortSignal,
): LanguageModelV3CallOptions {
  const {
    abortSignal: _abort_signal,
    headers: _headers,
    includeRawChunks: _include_raw_chunks,
    providerOptions: _provider_options,
    ...safe_call
  } = call;
  return {
    ...safe_call,
    abortSignal: signal,
  };
}

/** 将 AIChannel 标准模型流编码为 City transport SSE。 */
export function create_city_language_model_stream(
  input: CreateCityLanguageModelStreamInput,
): CityLanguageModelStreamExecution {
  const reader = input.result.stream.getReader();
  const encoder = new TextEncoder();
  let resolve_completion: (result: AIStreamCompletion<LanguageModelV3StreamPart>) => void = () => undefined;
  const completion = new Promise<AIStreamCompletion<LanguageModelV3StreamPart>>((resolve) => {
    resolve_completion = resolve;
  });
  let completed = false;
  let finish_part: LanguageModelV3StreamPart | undefined;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          complete(finish_part
            ? { outcome: "succeeded", result: finish_part }
            : { outcome: "failed", error: new Error("AI stream ended without final usage") });
          controller.close();
          return;
        }
        if (is_finish_part(chunk.value)) finish_part = chunk.value;
        controller.enqueue(encoder.encode(serialize_stream_part(chunk.value)));
      } catch (error) {
        controller.enqueue(encoder.encode(serialize_stream_part({ type: "error", error } as LanguageModelV3StreamPart)));
        complete({ outcome: "failed", ...(finish_part ? { result: finish_part } : {}), error });
        controller.close();
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        complete({ outcome: "cancelled", ...(finish_part ? { result: finish_part } : {}) });
      }
    },
  });

  return {
    response: new Response(body, { status: 200, headers: SSE_HEADERS }),
    completion,
  };

  /** 只完成一次 completion promise。 */
  function complete(result: AIStreamCompletion<LanguageModelV3StreamPart>): void {
    if (completed) return;
    completed = true;
    resolve_completion(result);
  }
}

/** 把标准 LanguageModelV3 事件编码成一个 SSE event。 */
function serialize_stream_part(part: LanguageModelV3StreamPart): string {
  const event: CityLanguageModelStreamEventV1 = {
    protocol: CITY_LANGUAGE_MODEL_PROTOCOL_V1,
    part: encode_city_transport_object(part),
  };
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** 判断流事件是否为包含可信 usage 的 finish。 */
function is_finish_part(part: LanguageModelV3StreamPart): boolean {
  return (part as { type?: unknown }).type === "finish";
}

/** 判断输入是否为 transport JSON 对象。 */
function is_json_object(value: unknown): value is CityTransportJsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** 读取必填非空字符串。 */
function read_required_string(value: unknown, field: string): string {
  const output = read_optional_string(value);
  if (!output) throw create_protocol_error(`${field} is required`);
  return output;
}

/** 读取可选非空字符串。 */
function read_optional_string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 创建会被 Federation 映射为 422 的协议错误。 */
function create_protocol_error(message: string): Error {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 422;
  return error;
}
