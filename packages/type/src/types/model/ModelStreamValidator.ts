/**
 * Downcity 模型流状态机校验模块。
 *
 * 该状态机属于 Model Protocol 本身，Federation、Agent 与其它客户端共享同一组
 * content 生命周期和终态不变量，避免各执行边界分别猜测合法事件顺序。
 */

import type { ModelStreamEvent } from "./ModelStreamEvent.js";

const FINISH_REASONS = new Set([
  "stop",
  "length",
  "tool_call",
  "content_filter",
  "cancelled",
  "error",
  "unknown",
]);

/** 校验单次 Downcity 模型流的事件顺序与字段不变量。 */
export class ModelStreamValidator {
  private started = false;
  private terminal = false;
  private saw_usage = false;
  private completed_tool_calls = 0;
  private readonly content_states = new Map<
    string,
    { kind: "text" | "reasoning" | "tool_call"; open: boolean }
  >();
  private readonly tool_call_ids = new Set<string>();

  /** 接受并校验一个流事件；协议无效时立即抛错。 */
  accept(event: ModelStreamEvent): void {
    if (!event || typeof event !== "object") {
      throw protocol_error("event must be an object");
    }
    if (this.terminal) throw protocol_error("event received after terminal event");
    if (event.type === "model_start") {
      if (this.started) throw protocol_error("model_start must appear exactly once");
      require_non_empty_string(event.request_id, "model_start.request_id");
      require_non_empty_string(event.model_id, "model_start.model_id");
      this.started = true;
      return;
    }
    if (!this.started) throw protocol_error(`${event.type} received before model_start`);

    if (event.type === "text_start" || event.type === "reasoning_start") {
      this.start_content(
        event.content_id,
        event.type === "text_start" ? "text" : "reasoning",
      );
      return;
    }
    if (event.type === "text_delta" || event.type === "reasoning_delta") {
      const kind = event.type === "text_delta" ? "text" : "reasoning";
      this.require_open_content(event.content_id, kind);
      if (typeof event.delta !== "string") {
        throw protocol_error(`${event.type}.delta must be a string`);
      }
      return;
    }
    if (event.type === "text_finish" || event.type === "reasoning_finish") {
      const kind = event.type === "text_finish" ? "text" : "reasoning";
      this.finish_content(event.content_id, kind);
      if (event.type === "reasoning_finish" && event.signature !== undefined) {
        require_non_empty_string(event.signature, "reasoning_finish.signature");
      }
      return;
    }
    if (event.type === "tool_call_start") {
      this.start_content(event.content_id, "tool_call");
      require_non_empty_string(event.tool_call_id, "tool_call_start.tool_call_id");
      require_non_empty_string(event.tool_name, "tool_call_start.tool_name");
      if (this.tool_call_ids.has(event.tool_call_id)) {
        throw protocol_error(`duplicate tool_call_id: ${event.tool_call_id}`);
      }
      this.tool_call_ids.add(event.tool_call_id);
      return;
    }
    if (event.type === "tool_call_delta") {
      this.require_open_content(event.content_id, "tool_call");
      if (typeof event.input_delta !== "string") {
        throw protocol_error("tool_call_delta.input_delta must be a string");
      }
      return;
    }
    if (event.type === "tool_call_finish") {
      this.finish_content(event.content_id, "tool_call");
      require_json_value(event.input, "tool_call_finish.input");
      this.completed_tool_calls += 1;
      return;
    }
    if (event.type === "model_usage") {
      validate_usage(event.usage);
      this.saw_usage = true;
      return;
    }
    if (event.type === "model_finish") {
      if (!FINISH_REASONS.has(event.finish_reason)) {
        throw protocol_error("model_finish.finish_reason is invalid");
      }
      if ([...this.content_states.values()].some((state) => state.open)) {
        throw protocol_error("model_finish received before all content finished");
      }
      if (!this.saw_usage) {
        throw protocol_error("model_finish requires final model_usage");
      }
      if (event.finish_reason === "tool_call" && this.completed_tool_calls === 0) {
        throw protocol_error("tool_call finish reason requires a completed tool call");
      }
      this.terminal = true;
      return;
    }
    if (event.type === "model_error") {
      require_non_empty_string(event.error.code, "model_error.error.code");
      require_non_empty_string(event.error.message, "model_error.error.message");
      if (typeof event.error.retryable !== "boolean") {
        throw protocol_error("model_error.error.retryable must be a boolean");
      }
      this.terminal = true;
      return;
    }
    throw protocol_error(`unknown model stream event: ${String((event as { type?: unknown }).type)}`);
  }

  /** 在底层流关闭时确认已经收到唯一终态。 */
  finish(): void {
    if (!this.started) throw protocol_error("model stream ended without model_start");
    if (!this.terminal) throw protocol_error("model stream ended without a terminal event");
  }

  /** 登记全局唯一的 content 生命周期。 */
  private start_content(
    content_id: string,
    kind: "text" | "reasoning" | "tool_call",
  ): void {
    require_non_empty_string(content_id, `${kind}_start.content_id`);
    if (this.content_states.has(content_id)) {
      throw protocol_error(`duplicate content_id: ${content_id}`);
    }
    this.content_states.set(content_id, { kind, open: true });
  }

  /** 读取指定类型的活跃 content。 */
  private require_open_content(
    content_id: string,
    kind: "text" | "reasoning" | "tool_call",
  ): void {
    require_non_empty_string(content_id, `${kind}.content_id`);
    const state = this.content_states.get(content_id);
    if (!state || !state.open || state.kind !== kind) {
      throw protocol_error(`${kind} content is not open: ${content_id}`);
    }
  }

  /** 关闭指定 content，并拒绝重复 finish。 */
  private finish_content(
    content_id: string,
    kind: "text" | "reasoning" | "tool_call",
  ): void {
    this.require_open_content(content_id, kind);
    const state = this.content_states.get(content_id);
    if (state) state.open = false;
  }
}

/** 校验 usage 只包含可解释的非负 token 累计值。 */
function validate_usage(
  usage: Extract<ModelStreamEvent, { type: "model_usage" }>["usage"],
): void {
  if (!usage || typeof usage !== "object") throw protocol_error("model_usage.usage must be an object");
  for (const field of ["input_tokens", "output_tokens", "total_tokens"] as const) {
    const value = usage[field];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw protocol_error(`model_usage.usage.${field} must be a non-negative integer`);
    }
  }
  if (usage.total_tokens !== usage.input_tokens + usage.output_tokens) {
    throw protocol_error("model_usage.usage.total_tokens must equal input_tokens + output_tokens");
  }
  for (const field of [
    "cached_input_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
  ] as const) {
    const value = usage[field];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw protocol_error(`model_usage.usage.${field} must be a non-negative integer`);
    }
  }
}

/** 校验协议必填字符串。 */
function require_non_empty_string(value: unknown, field: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw protocol_error(`${field} must be a non-empty string`);
  }
}

/** 递归校验工具调用输入为 JSON 值。 */
function require_json_value(value: unknown, field: string): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => require_json_value(item, `${field}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      require_json_value(item, `${field}.${key}`);
    }
    return;
  }
  throw protocol_error(`${field} must be valid JSON`);
}

/** 创建稳定的模型流协议错误。 */
function protocol_error(message: string): Error {
  return new Error(`Invalid Downcity model stream: ${message}`);
}
