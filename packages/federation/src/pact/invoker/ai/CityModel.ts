/**
 * CityModel 原生 LanguageModelV3 实现。
 *
 * Agent 将该类直接交给 AI SDK。类内部负责把标准模型调用编码为 City transport、
 * 请求 Federation、解析 SSE，并重新输出标准 LanguageModelV3 结果。
 */

import { CITY_MODEL_KIND, type CityModel as CityModelContract } from "@downcity/type";
import {
  CITY_LANGUAGE_MODEL_PROTOCOL_V1,
  type CityLanguageModelStreamEventV1,
  type CityLanguageModelStreamRequestV1,
  type CityTransportJsonValue,
} from "../../../types/AITransport.js";
import type { CityModelOptions } from "../../../types/AITransport.js";
import {
  decode_city_transport_value,
  encode_city_transport_object,
} from "../../../utils/CityLanguageModelCodec.js";
import { collect_city_language_model_stream } from "../../../utils/CityLanguageModelResult.js";

type CityCallOptions = Parameters<CityModelContract["doStream"]>[0];
type CityStreamResult = Awaited<ReturnType<CityModelContract["doStream"]>>;
type CityGenerateResult = Awaited<ReturnType<CityModelContract["doGenerate"]>>;
type CityStreamPart = CityStreamResult["stream"] extends ReadableStream<infer T> ? T : never;

/** Federation 模型目录中的可执行 City 模型。 */
export class CityModel implements CityModelContract {
  readonly kind = CITY_MODEL_KIND;
  readonly specificationVersion = "v3" as const;
  readonly provider = "downcity";
  readonly supportedUrls: Record<string, RegExp[]> = {};
  readonly modelId: string;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly context_window?: number;
  readonly modalities: string[];
  readonly tags: string[];
  readonly price?: string[];
  readonly meta: Record<string, unknown>;
  readonly reasoning: CityModelContract["reasoning"];
  readonly env_requirements: CityModelContract["env_requirements"];

  private readonly request_stream: CityModelOptions["request_stream"];

  constructor(options: CityModelOptions) {
    const descriptor = options.descriptor;
    this.id = descriptor.id;
    this.modelId = descriptor.id;
    this.name = descriptor.name;
    this.description = descriptor.description;
    this.context_window = descriptor.context_window;
    this.modalities = [...descriptor.modalities];
    this.tags = [...descriptor.tags];
    this.price = descriptor.price ? [...descriptor.price] : undefined;
    this.meta = { ...descriptor.meta };
    this.reasoning = descriptor.reasoning;
    this.env_requirements = descriptor.env_requirements;
    this.request_stream = options.request_stream;
  }

  /** 执行原生 City LanguageModel 流式调用。 */
  async doStream(options: CityCallOptions): Promise<CityStreamResult> {
    const request = this.create_request(options);
    const response = await this.request_stream(request, options.abortSignal);
    if (!response.body) throw new Error("Federation language model response body is empty");
    const content_type = response.headers?.get("content-type");
    if (content_type && !content_type.toLowerCase().includes("text/event-stream")) {
      throw new Error(`Federation language model returned unsupported content type: ${content_type}`);
    }
    return {
      stream: parse_city_model_stream(response.body),
      request: { body: request },
    };
  }

  /** 通过聚合原生流实现非流式模型调用。 */
  async doGenerate(options: CityCallOptions): Promise<CityGenerateResult> {
    const result = await this.doStream(options);
    return collect_city_language_model_stream(result.stream, result.request?.body);
  }

  /** 将 AI SDK 调用参数转换为 City transport 请求。 */
  private create_request(options: CityCallOptions): CityLanguageModelStreamRequestV1 {
    const {
      abortSignal: _abort_signal,
      headers: _headers,
      includeRawChunks: _include_raw_chunks,
      providerOptions,
      ...call
    } = options;
    const downcity_options = providerOptions?.downcity as Record<string, unknown> | undefined;
    const reasoning_effort = read_optional_string(
      downcity_options?.reasoningEffort ?? downcity_options?.reasoning_effort,
    );
    return {
      protocol: CITY_LANGUAGE_MODEL_PROTOCOL_V1,
      model_id: this.modelId,
      call: encode_city_transport_object(call),
      ...(reasoning_effort ? { reasoning_effort } : {}),
    };
  }
}

/** 解析 Federation 返回的标准 SSE 数据流。 */
function parse_city_model_stream(body: ReadableStream<Uint8Array>): ReadableStream<CityStreamPart> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data_lines: string[] = [];

  return new ReadableStream<CityStreamPart>({
    async pull(controller) {
      try {
        while (true) {
          const event = read_sse_event();
          if (event !== undefined) {
            controller.enqueue(parse_stream_event(event));
            return;
          }
          const chunk = await reader.read();
          if (chunk.done) {
            buffer += decoder.decode();
            consume_sse_lines(true);
            const final_event = read_sse_event();
            if (final_event !== undefined) controller.enqueue(parse_stream_event(final_event));
            controller.close();
            return;
          }
          buffer += decoder.decode(chunk.value, { stream: true });
          consume_sse_lines(false);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });

  /** 把当前 buffer 中的完整行消费进 SSE data 队列。 */
  function consume_sse_lines(flush: boolean): void {
    const lines = buffer.split(/\r?\n/u);
    buffer = flush ? "" : lines.pop() ?? "";
    for (const line of lines) {
      if (line === "") {
        if (data_lines.length > 0) data_lines.push("");
        continue;
      }
      if (line.startsWith(":")) continue;
      if (line.startsWith("data:")) data_lines.push(line.slice(5).trimStart());
    }
  }

  /** 读取一个已经以空行结尾的 SSE event。 */
  function read_sse_event(): string | undefined {
    const boundary = data_lines.indexOf("");
    if (boundary < 0) return undefined;
    const event = data_lines.slice(0, boundary).join("\n");
    data_lines = data_lines.slice(boundary + 1);
    return event || undefined;
  }
}

/** 校验并解码单个 City transport 流事件。 */
function parse_stream_event(data: string): CityStreamPart {
  const parsed = JSON.parse(data) as CityLanguageModelStreamEventV1;
  if (parsed.protocol !== CITY_LANGUAGE_MODEL_PROTOCOL_V1) {
    throw new Error(`Unsupported City language model protocol: ${String(parsed.protocol)}`);
  }
  if (!parsed.part || typeof parsed.part !== "object" || Array.isArray(parsed.part)) {
    throw new Error("Federation returned an invalid City language model stream event");
  }
  return decode_city_transport_value(parsed.part as CityTransportJsonValue) as CityStreamPart;
}

/** 读取非空可选字符串。 */
function read_optional_string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
