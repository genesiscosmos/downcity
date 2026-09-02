/**
 * 模型流失败对象。
 *
 * 该对象完整保留 Model Protocol 的错误分类，避免 Executor 只能依赖错误文本
 * 判断是否可以重试。它只描述一次模型流失败，不负责决定恢复策略。
 */

import type { ModelError } from "@downcity/type";

/** 一次具有稳定协议语义的模型流失败。 */
export class ModelStreamFailure extends Error {
  /** Downcity 稳定模型错误码。 */
  readonly code: ModelError["code"];

  /** 当前模型调用是否可以安全重试。 */
  readonly retryable: boolean;

  /** 失败前是否已经向用户发布正文或工具输入。 */
  readonly has_partial_output: boolean;

  constructor(error: ModelError, has_partial_output: boolean) {
    super(error.message);
    this.name = "ModelStreamFailure";
    this.code = error.code;
    this.retryable = error.retryable;
    this.has_partial_output = has_partial_output;
  }
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
