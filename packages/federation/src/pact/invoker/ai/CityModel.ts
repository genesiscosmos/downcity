/**
 * CityModel 原生 Downcity Model Protocol 客户端实现。
 *
 * 类内部负责请求 Federation 并把 SSE 解码成标准 ModelStreamEvent。
 */

import {
  CITY_MODEL_KIND,
  MODEL_PROTOCOL_VERSION,
  ModelStreamValidator,
  type CityModel as CityModelContract,
  type ModelCall,
  type ModelStreamEnvelope,
  type ModelStreamEvent,
  type ModelStreamRequest,
} from "@downcity/type";
import type { CityModelOptions } from "../../../types/AITransport.js";

/** Federation 模型目录中的可执行 City 模型。 */
export class CityModel implements CityModelContract {
  readonly kind = CITY_MODEL_KIND;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly context_window?: number;
  readonly modalities: string[];
  readonly tags: string[];
  readonly pricing?: CityModelContract["pricing"];
  readonly meta: Record<string, unknown>;
  readonly reasoning: CityModelContract["reasoning"];
  readonly env_requirements: CityModelContract["env_requirements"];

  private readonly request_stream: CityModelOptions["request_stream"];

  constructor(options: CityModelOptions) {
    const descriptor = options.descriptor;
    this.id = descriptor.id;
    this.name = descriptor.name;
    this.description = descriptor.description;
    this.context_window = descriptor.context_window;
    this.modalities = [...descriptor.modalities];
    this.tags = [...descriptor.tags];
    this.pricing = descriptor.pricing;
    this.meta = { ...descriptor.meta };
    this.reasoning = descriptor.reasoning;
    this.env_requirements = descriptor.env_requirements;
    this.request_stream = options.request_stream;
  }

  /** 使用 Downcity Model Protocol 执行一个模型 step。 */
  async stream(call: ModelCall, signal?: AbortSignal): Promise<ReadableStream<ModelStreamEvent>> {
    const request: ModelStreamRequest = {
      protocol_version: MODEL_PROTOCOL_VERSION,
      model_id: this.id,
      call,
    };
    const response = await this.request_stream(request, signal);
    if (!response.body) throw new Error("Federation language model response body is empty");
    const content_type = response.headers?.get("content-type");
    if (content_type && !content_type.toLowerCase().includes("text/event-stream")) {
      throw new Error(`Federation language model returned unsupported content type: ${content_type}`);
    }
    return parse_city_model_stream(response.body, {
      model_id: this.id,
      request_id: response.headers?.get("x-request-id") || undefined,
      signal,
    });
  }
}

/** 解析 Federation 返回的标准 SSE 数据流。 */
function parse_city_model_stream(
  body: ReadableStream<Uint8Array>,
  context: { model_id: string; request_id?: string; signal?: AbortSignal },
): ReadableStream<ModelStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data_lines: string[] = [];
  let model_started = false;
  const validator = new ModelStreamValidator();

  return new ReadableStream<ModelStreamEvent>({
    async pull(controller) {
      try {
        while (true) {
          const event = read_sse_event();
          if (event !== undefined) {
            const parsed_event = parse_stream_event(event);
            validator.accept(parsed_event);
            if (parsed_event.type === "model_start") model_started = true;
            controller.enqueue(parsed_event);
            return;
          }
          const chunk = await reader.read();
          if (chunk.done) {
            buffer += decoder.decode();
            consume_sse_lines(false);
            const final_event = read_sse_event();
            if (final_event !== undefined) {
              const parsed_event = parse_stream_event(final_event);
              validator.accept(parsed_event);
              if (parsed_event.type === "model_start") model_started = true;
              controller.enqueue(parsed_event);
              return;
            }
            if (buffer.trim() || data_lines.some((line) => line.trim())) {
              enqueue_stream_error(
                controller,
                "transport_error",
                "Federation model stream ended with an incomplete SSE event",
                true,
              );
              return;
            }
            validator.finish();
            controller.close();
            return;
          }
          buffer += decoder.decode(chunk.value, { stream: true });
          consume_sse_lines(false);
        }
      } catch (error) {
        const cancelled = context.signal?.aborted === true ||
          (error instanceof DOMException && error.name === "AbortError");
        const transport_error = cancelled || error instanceof TypeError;
        enqueue_stream_error(
          controller,
          cancelled ? "cancelled" : transport_error ? "transport_error" : "provider_error",
          cancelled
            ? "Federation model stream was cancelled"
            : transport_error
              ? "Federation model stream terminated before completion"
              : "Federation returned an invalid model stream event",
          transport_error && !cancelled,
        );
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

  /** 以标准终态结束损坏的 transport，供 Agent 复用统一恢复策略。 */
  function enqueue_stream_error(
    controller: ReadableStreamDefaultController<ModelStreamEvent>,
    code: "cancelled" | "provider_error" | "transport_error",
    message: string,
    retryable: boolean,
  ): void {
    if (!model_started) {
      const start_event: ModelStreamEvent = {
        type: "model_start",
        request_id: context.request_id || `transport_${crypto.randomUUID()}`,
        model_id: context.model_id,
      };
      validator.accept(start_event);
      controller.enqueue(start_event);
      model_started = true;
    }
    const event: ModelStreamEvent = {
      type: "model_error",
      error: {
        code,
        message,
        retryable,
        ...(context.request_id ? { provider_request_id: context.request_id } : {}),
      },
    };
    validator.accept(event);
    controller.enqueue(event);
    controller.close();
  }
}

/** 校验并解码单个 City transport 流事件。 */
function parse_stream_event(data: string): ModelStreamEvent {
  let parsed: ModelStreamEnvelope;
  try {
    parsed = JSON.parse(data) as ModelStreamEnvelope;
  } catch {
    throw new Error("Federation returned an invalid model stream JSON event");
  }
  if (parsed.protocol_version !== MODEL_PROTOCOL_VERSION) {
    throw new Error(`Unsupported Downcity model protocol: ${String(parsed.protocol_version)}`);
  }
  if (!parsed.event || typeof parsed.event !== "object" || Array.isArray(parsed.event)) {
    throw new Error("Federation returned an invalid Downcity model stream event");
  }
  return parsed.event;
}
