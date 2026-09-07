/**
 * Agent 模型请求统一执行器。
 *
 * 本模块唯一拥有请求重试次数、退避和逐次失败通知；具体模型流解析由调用方提供。
 */

import type { ModelRequestKind } from "@downcity/type";
import type { ModelRequestFailureReporter } from "@/types/executor/ModelRequest.js";
import {
  ModelStreamFailure,
  is_retryable_empty_model_stream_failure,
} from "@executor/model/ModelStreamFailure.js";

/** 首次模型调用失败后的最大自动重试次数。 */
export const MAX_MODEL_REQUEST_RETRIES = 5;

/** 包含首次调用与自动重试在内的最大模型调用次数。 */
export const MAX_MODEL_REQUEST_ATTEMPTS = MAX_MODEL_REQUEST_RETRIES + 1;

/** 模型请求重试退避，避免连续冲击同一 Provider。 */
const MODEL_REQUEST_RETRY_DELAYS_MS = [300, 1_000, 2_000, 4_000, 8_000] as const;

/** 统一模型请求执行参数。 */
interface ExecuteModelRequestInput<TResult> {
  /** 当前模型请求用途。 */
  request_kind: ModelRequestKind;
  /** 执行一次模型调用及其流消费。 */
  execute_attempt: () => Promise<TResult>;
  /** 可选取消信号。 */
  abort_signal?: AbortSignal;
  /** 可选逐次失败通知入口。 */
  on_failure?: ModelRequestFailureReporter;
  /** 判断错误是否交给当前执行器自动重试。 */
  should_retry?: (error: ModelStreamFailure) => boolean;
}

/** 执行一次带统一恢复策略的模型请求。 */
export async function execute_model_request<TResult>(
  input: ExecuteModelRequestInput<TResult>,
): Promise<TResult> {
  for (let attempt = 1; attempt <= MAX_MODEL_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      return await input.execute_attempt();
    } catch (error) {
      if (!(error instanceof ModelStreamFailure)) throw error;
      const eligible_for_retry =
        error.code !== "cancelled" &&
        input.abort_signal?.aborted !== true &&
        is_retryable_empty_model_stream_failure(error) &&
        (input.should_retry?.(error) ?? true);
      const can_retry =
        eligible_for_retry && attempt < MAX_MODEL_REQUEST_ATTEMPTS;
      if (error.code !== "cancelled" && input.abort_signal?.aborted !== true) {
        try {
          await input.on_failure?.({
            request_kind: input.request_kind,
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            attempt,
            max_attempts: eligible_for_retry
              ? MAX_MODEL_REQUEST_ATTEMPTS
              : attempt,
            will_retry: can_retry,
            ...(error.provider_request_id
              ? { provider_request_id: error.provider_request_id }
              : {}),
          }, error);
        } catch {
          // 关键点（中文）：诊断通知失败不能改变模型请求恢复结果。
        }
      }
      if (!can_retry) throw error;
      await wait_for_model_request_retry(
        resolve_model_request_retry_delay(attempt),
        input.abort_signal,
      );
    }
  }
  throw new Error("Model request retry state is invalid");
}

/** 读取指定重试序号对应的退避时间。 */
function resolve_model_request_retry_delay(retry_count: number): number {
  return MODEL_REQUEST_RETRY_DELAYS_MS[retry_count - 1] ??
    MODEL_REQUEST_RETRY_DELAYS_MS.at(-1) ??
    8_000;
}

/** 等待下一次模型请求，并在调用方取消时立即结束。 */
async function wait_for_model_request_retry(
  delay_ms: number,
  abort_signal?: AbortSignal,
): Promise<void> {
  if (abort_signal?.aborted) throw abort_signal.reason;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      abort_signal?.removeEventListener("abort", on_abort);
      resolve();
    }, delay_ms);
    const on_abort = (): void => {
      clearTimeout(timer);
      reject(abort_signal?.reason);
    };
    abort_signal?.addEventListener("abort", on_abort, { once: true });
  });
}
