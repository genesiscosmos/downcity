/**
 * ModelFailure：模型调用错误归一化。
 *
 * 关键点（中文）
 * - 模型流的最终错误可能只是兜底包装，底层 Provider 错误应优先保留。
 * - 执行器只需要消费这里输出的日志字段与最终错误文本。
 */

import type { JsonObject } from "@downcity/type";

/**
 * 归一化 stream 错误日志字段。
 */
export function summarize_stream_error(error: unknown): JsonObject {
  const record =
    error && typeof error === "object" && !Array.isArray(error)
      ? (error as Record<string, unknown>)
      : {};
  const cause = record.cause;
  return {
    error: String(error),
    name: typeof record.name === "string" ? record.name : null,
    message: typeof record.message === "string" ? record.message : null,
    cause: cause === undefined ? null : String(cause),
  };
}

/**
 * 提取实际应返回给上层的错误文本。
 */
export function resolve_model_error(params: {
  /**
   * 外层捕获到的执行错误。
   */
  error: unknown;
  /**
   * stream `onError` 捕获到的底层错误。
   */
  streamError?: unknown;
}): string {
  const outerError = read_error_message(params.error);
  const innerError = read_error_message(params.streamError);
  if (/AI_NoOutputGeneratedError|No output generated/i.test(outerError) && innerError) {
    return innerError;
  }
  return outerError || innerError || "Unknown execution error";
}

/** 读取适合向上层展示的错误正文，避免泄漏内部 Error class 名称。 */
function read_error_message(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  return String(error ?? "").trim();
}
