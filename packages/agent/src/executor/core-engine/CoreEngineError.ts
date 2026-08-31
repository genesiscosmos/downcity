/**
 * CoreEngine 执行错误归一化工具。
 *
 * 关键点（中文）
 * - 模型流的最终错误可能只是兜底包装，底层 Provider 错误应优先保留。
 * - Executor 内部 CoreEngine 流程只需要消费这里输出的日志字段与最终错误文本。
 */

import type { JsonObject } from "@/types/common/Json.js";

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
export function resolve_effective_core_engine_error(params: {
  /**
   * 外层捕获到的执行错误。
   */
  error: unknown;
  /**
   * stream `onError` 捕获到的底层错误。
   */
  streamError?: unknown;
}): string {
  const outerError = String(params.error ?? "").trim();
  const innerError = String(params.streamError ?? "").trim();
  if (/AI_NoOutputGeneratedError|No output generated/i.test(outerError) && innerError) {
    return innerError;
  }
  return outerError || innerError || "Unknown execution error";
}
