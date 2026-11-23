/**
 * CityModel 原生 Downcity Model Protocol 客户端实现。
 *
 * 类内部负责请求 Downtown、校验 SSE 与模型状态机，并把失败转换为安全的标准终态。
 * 流诊断仅记录请求关联、事件统计和固定原因，禁止记录原始帧与底层异常文本。
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

/** Downtown 模型目录中的可执行 City 模型。 */
export class CityModel implements CityModelContract {
  readonly kind = CITY_MODEL_KIND;
  readonly id: string;
  readonly model_type: CityModelContract["model_type"];
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
    this.model_type = descriptor.model_type;
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
    if (!response.body) throw new Error("Downtown language model response body is empty");
    const content_type = response.headers?.get("content-type");
    if (content_type && !content_type.toLowerCase().includes("text/event-stream")) {
      throw new Error("Downtown language model returned unsupported content type");
    }
    const header_id = response.headers?.get("x-request-id");
    return parse_city_model_stream(response.body, {
      model_id: this.id,
      request_id: header_id && REQUEST_ID_PATTERN.test(header_id) ? header_id : undefined,
      signal,
    });
  }
}

/** 关联标识只允许有限长度的协议字符，不记录任意响应头或上游文本。 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:/-]{1,128}$/;

/** 固定的安全诊断原因；任何网络正文与异常文本都不能进入这些消息。 */
const STREAM_FAILURES = {
  eof_before_terminal: {
    code: "transport_error",
    message: "Downtown model stream ended before a terminal event was received",
    retryable: true,
  },
  incomplete_sse: {
    code: "transport_error",
    message: "Downtown model stream ended with an incomplete SSE event",
    retryable: true,
  },
  read_failed: {
    code: "transport_error",
    message: "Downtown model stream could not be read to completion",
    retryable: true,
  },
  cancelled: {
    code: "cancelled",
    message: "Downtown model stream was cancelled",
    retryable: false,
  },
  invalid_json: {
    code: "provider_error",
    message: "Downtown model stream contained invalid JSON",
    retryable: false,
  },
  invalid_envelope: {
    code: "provider_error",
    message: "Downtown model stream contained an invalid envelope",
    retryable: false,
  },
  unsupported_protocol_version: {
    code: "provider_error",
    message: "Downtown model stream used an unsupported protocol version",
    retryable: false,
  },
  invalid_event: {
    code: "provider_error",
    message: "Downtown model stream contained an invalid event object",
    retryable: false,
  },
  invalid_state_transition: {
    code: "provider_error",
    message: "Downtown model stream violated event order or field requirements",
    retryable: false,
  },
} as const;

/** 仅携带固定原因，避免校验器的动态字段内容泄漏到模型错误或日志。 */
class CityModelStreamError extends Error {
  constructor(
    /** 本地固定诊断原因，不包含远端数据。 */
    readonly reason: keyof typeof STREAM_FAILURES,
  ) {
    super(`${STREAM_FAILURES[reason].message} (reason: ${reason})`);
  }
}

/** 解析 Downtown 返回的标准 SSE 数据流，并独立维护传输结束与协议终态。 */
function parse_city_model_stream(
  body: ReadableStream<Uint8Array>,
  context: {
    /** 当前调用的模型标识，用于合成起始事件与关联诊断。 */
    model_id: string;
    /** Downtown 响应头中的请求标识，沿用现有 transport 错误映射。 */
    request_id?: string;
    /** 调用方取消信号，取消必须保留独立失败语义。 */
    signal?: AbortSignal;
  },
): ReadableStream<ModelStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const validator = new ModelStreamValidator();
  let buffer = "";
  let data_lines: string[] = [];
  const pending_events: string[] = [];
  let model_started = false;
  let body_done = false;
  let consumer_cancelled = false;
  let diagnostic_written = false;
  let reader_released = false;
  let upstream_request_id: string | undefined;
  let request_id = context.request_id || `transport_${crypto.randomUUID()}`;
  // 统计只包含通过校验的远端事件，合成的起始与错误事件不计入。
  let event_count = 0;
  let last_event_type: ModelStreamEvent["type"] | undefined;

  return new ReadableStream<ModelStreamEvent>({
    async pull(controller) {
      while (!consumer_cancelled) {
        if (context.signal?.aborted) {
          end_with_failure(controller, "cancelled");
          return;
        }
        const data = pending_events.shift();
        if (data !== undefined) {
          let parsed_event: ModelStreamEvent;
          try {
            parsed_event = parse_stream_event(data);
            validator.accept(parsed_event);
          } catch (error) {
            end_with_failure(controller, error instanceof CityModelStreamError
              ? error.reason : "invalid_state_transition");
            return;
          }
          event_count += 1;
          last_event_type = parsed_event.type;
          if (parsed_event.type === "model_start") {
            model_started = true;
            if (REQUEST_ID_PATTERN.test(parsed_event.request_id)) {
              upstream_request_id = parsed_event.request_id;
              if (!context.request_id) request_id = upstream_request_id;
            }
          }
          controller.enqueue(parsed_event);
          if (parsed_event.type === "model_finish" || parsed_event.type === "model_error") {
            // 合法终态就是生命周期边界：停止读取，保留真实终态，不等待无界 EOF。
            write_diagnostic(parsed_event.type === "model_error" ? "model_error" : "completed");
            controller.close();
            void cancel_reader();
          }
          return;
        }
        if (body_done) {
          if (buffer.trim() || data_lines.some((line) => line.trim())) {
            end_with_failure(controller, "incomplete_sse");
          } else {
            // 完整 SSE 帧之后缺少终态也是断流，不能让 validator.finish() 抹成协议错误。
            end_with_failure(controller, "eof_before_terminal");
          }
          return;
        }
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (error) {
          if (consumer_cancelled) return;
          const cancelled = context.signal?.aborted === true ||
            (error instanceof DOMException && error.name === "AbortError");
          end_with_failure(controller, cancelled ? "cancelled" : "read_failed");
          return;
        }
        if (consumer_cancelled) return;
        body_done = chunk.done;
        buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
        consume_sse_lines();
      }
    },
    cancel() {
      consumer_cancelled = true;
      write_diagnostic("consumer_cancelled");
      // 消费方取消原因可能包含调用方数据，不向日志或底层取消回调透传。
      cancel_reader();
    },
  });

  /** 完整帧单独排队，避免把空 data 行当成帧结束或跳过后续已缓存事件。 */
  function consume_sse_lines(): void {
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "") {
        if (data_lines.length > 0) {
          const event = data_lines.join("\n");
          if (event) pending_events.push(event);
          data_lines = [];
        }
        continue;
      }
      if (line.startsWith(":")) continue;
      if (line === "data") data_lines.push("");
      else if (line.startsWith("data:")) data_lines.push(line.slice(5).replace(/^ /u, ""));
    }
  }

  /** 此入口只处理终态前的失败；合法终态在接受时已关闭流，不再合成第二终态。 */
  function end_with_failure(
    controller: ReadableStreamDefaultController<ModelStreamEvent>,
    reason: keyof typeof STREAM_FAILURES,
  ): void {
    const failure = STREAM_FAILURES[reason];
    const error = new CityModelStreamError(reason);
    write_diagnostic(reason);
    if (!model_started) {
      const start_event: ModelStreamEvent = {
        type: "model_start",
        request_id,
        model_id: context.model_id,
      };
      validator.accept(start_event);
      controller.enqueue(start_event);
      model_started = true;
    }
    const event: ModelStreamEvent = {
      type: "model_error",
      error: {
        code: failure.code,
        message: error.message,
        retryable: failure.retryable,
        // 沿用现有响应头映射；不把 model_start 的关联 ID 冒充供应商请求 ID。
        ...(context.request_id ? { provider_request_id: context.request_id } : {}),
      },
    };
    validator.accept(event);
    controller.enqueue(event);
    controller.close();
    void cancel_reader();
  }

  /** 每条流只写一条克制统计，不记录 delta、未知事件类型或任意原始异常。 */
  function write_diagnostic(reason: keyof typeof STREAM_FAILURES | "completed" | "model_error" | "consumer_cancelled"): void {
    if (diagnostic_written) return;
    diagnostic_written = true;
    try {
      console.info("model_stream.transport", {
        request_id, upstream_request_id,
        model_id: context.model_id,
        phase: reason === "cancelled" || reason === "consumer_cancelled" ? "cancelled"
          : reason === "completed" ? "finished" : "failed",
        event_count, last_event_type, reason,
      });
    } catch { /* 诊断失败不能覆盖模型结果。 */ }
  }

  /** 传输资源由解析器持有；清理异常既不能覆盖主错误，也不能带出底层消息。 */
  function cancel_reader(): void {
    if (reader_released) return;
    reader_released = true;
    try { void reader.cancel().catch(() => undefined); }
    catch { /* 已关闭或损坏的传输不再产生第二个错误。 */ }
    finally {
      try { reader.releaseLock(); }
      catch { /* 清理失败不能覆盖已确定终态。 */ }
    }
  }
}

/** 校验并解码单个 City transport 流事件，只抛出固定安全原因。 */
function parse_stream_event(data: string): ModelStreamEvent {
  let parsed: ModelStreamEnvelope;
  try {
    parsed = JSON.parse(data) as ModelStreamEnvelope;
  } catch {
    throw new CityModelStreamError("invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
    !("protocol_version" in parsed) || !("event" in parsed)) {
    throw new CityModelStreamError("invalid_envelope");
  }
  if (parsed.protocol_version !== MODEL_PROTOCOL_VERSION) {
    throw new CityModelStreamError("unsupported_protocol_version");
  }
  if (!parsed.event || typeof parsed.event !== "object" || Array.isArray(parsed.event)) {
    throw new CityModelStreamError("invalid_event");
  }
  return parsed.event;
}
