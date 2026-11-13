/**
 * 模型流失败对象。
 *
 * 该对象完整保留 Model Protocol 的错误分类，避免 Executor 只能依赖错误文本
 * 判断是否可以重试。它只描述一次模型流失败，不负责决定恢复策略。
 */

import { read_model_error, type ModelError } from "@downcity/type";

/** 一次具有稳定协议语义的模型流失败。 */
export class ModelStreamFailure extends Error {
  /** Downcity 稳定模型错误码。 */
  readonly code: ModelError["code"];

  /** 当前模型调用是否可以安全重试。 */
  readonly retryable: boolean;

  /** 失败前是否已经向用户发布正文或工具输入。 */
  readonly has_partial_output: boolean;

  /** Provider 返回的可观测请求标识。 */
  readonly provider_request_id?: string;

  /** 保留 HTTP 拒绝状态供诊断；恢复策略优先使用 code。 */
  readonly status_code?: number;
  /** 上游建议的下一次调用 Unix 毫秒时间；重试时保持原始截止。 */
  readonly retry_at_ms?: number;
  /** 具体超时阶段，用于区分恢复预算和调用方取消。 */
  readonly timeout_phase?: ModelError["timeout_phase"];
  /** 上游结构化错误码。 */
  readonly provider_error_code?: string;
  /** 被拒绝的参数路径，不包含参数值。 */
  readonly provider_error_param?: string;
  /** 白名单归一化的原因摘要。 */
  readonly provider_error_reason?: string;

  constructor(error: ModelError, has_partial_output: boolean) {
    super(error.message);
    this.name = "ModelStreamFailure";
    this.code = error.code;
    this.retryable = error.retryable;
    this.has_partial_output = has_partial_output;
    this.status_code = error.status_code;
    this.retry_at_ms = error.retry_at_ms;
    this.timeout_phase = error.timeout_phase;
    this.provider_error_code = error.provider_error_code;
    this.provider_error_param = error.provider_error_param;
    this.provider_error_reason = error.provider_error_reason;
    if (error.provider_request_id) {
      this.provider_request_id = error.provider_request_id;
    }
  }
}

/** 把 ModelClient 直接抛出的调用异常归一为可恢复的模型传输失败。 */
export function normalize_model_invocation_failure(
  error: unknown,
  has_partial_output: boolean,
  abort_signal?: AbortSignal,
): ModelStreamFailure {
  if (error instanceof ModelStreamFailure) return error;
  const abort_error = abort_signal?.aborted ? read_model_error(
    abort_signal.reason && typeof abort_signal.reason === "object" && "model_error" in abort_signal.reason
      ? abort_signal.reason.model_error : undefined,
  ) : undefined;
  if (abort_error) return new ModelStreamFailure(abort_error, has_partial_output);
  const cancelled = abort_signal?.aborted === true;
  const classified = error && typeof error === "object"
    ? read_model_error("model_error" in error ? error.model_error : error) : undefined;
  if (!cancelled && classified) return new ModelStreamFailure(classified, has_partial_output);
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = Number(record.status_code ?? record.statusCode ?? record.status);
  if (!cancelled && Number.isInteger(status) && status >= 400 && status <= 599) {
    const code: ModelError["code"] = status === 401 ? "authentication_failed"
      : status === 403 ? "permission_denied" : status === 404 ? "model_unavailable"
      : status === 429 ? "rate_limited" : status === 408 || status === 504 ? "provider_timeout"
      : status >= 500 ? "provider_error" : "invalid_request";
    return new ModelStreamFailure(read_model_error({
      code, status_code: status,
      retryable: code === "rate_limited" || code === "provider_error" || code === "provider_timeout",
    })!, has_partial_output);
  }
  return new ModelStreamFailure({
    code: cancelled ? "cancelled" : "transport_error",
    message: error instanceof Error ? error.message : String(error),
    retryable: !cancelled,
  }, has_partial_output);
}

/** 把不合法的模型协议流归一为不可重试的 Provider 失败。 */
export function normalize_model_protocol_failure(
  error: unknown,
  has_partial_output: boolean,
): ModelStreamFailure {
  if (error instanceof ModelStreamFailure) return error;
  return new ModelStreamFailure({
    code: "provider_error",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  }, has_partial_output);
}

/** 判断未知错误是否为可安全自动重试的无输出模型流失败。 */
export function is_retryable_empty_model_stream_failure(
  error: unknown,
): error is ModelStreamFailure {
  return error instanceof ModelStreamFailure &&
    error.retryable &&
    !error.has_partial_output &&
    error.code !== "cancelled";
}
