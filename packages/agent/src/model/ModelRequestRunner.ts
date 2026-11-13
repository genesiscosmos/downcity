/**
 * Agent 模型请求统一执行器。
 *
 * 本模块唯一拥有请求重试次数、退避和逐次失败通知；具体模型流解析由调用方提供。
 */

import { create_model_timeout_error, read_model_error } from "@downcity/type";
import type { ExecuteModelRequestInput } from "@/types/model/ModelRecovery.js";
import { ModelStreamFailure, is_retryable_empty_model_stream_failure } from "@/model/ModelStreamFailure.js";

/** 首次模型调用失败后的最大自动重试次数。 */
export const MAX_MODEL_REQUEST_RETRIES = 5;

/** 包含首次调用与自动重试在内的最大模型调用次数。 */
export const MAX_MODEL_REQUEST_ATTEMPTS = MAX_MODEL_REQUEST_RETRIES + 1;

/** 模型请求重试退避，避免连续冲击同一 Provider。 */
const MODEL_REQUEST_RETRY_DELAYS_MS = [300, 1_000, 2_000, 4_000, 8_000] as const;

/** 所有尝试和重试等待共享的墙钟预算；不为每次重试重新授予。 */
const MODEL_RECOVERY_TIMEOUT_MS = 900_000;

/** 执行一次有限模型恢复；模型信号与工具信号由调用方明确分开。 */
export async function execute_model_request<TResult>(input: ExecuteModelRequestInput<TResult>): Promise<TResult> {
  const recovery_timeout_ms = input.recovery_timeout_ms ?? MODEL_RECOVERY_TIMEOUT_MS;
  if (!Number.isSafeInteger(recovery_timeout_ms) || recovery_timeout_ms < 1 || recovery_timeout_ms > 2_147_483_647) {
    throw new Error("Invalid model recovery timeout");
  }
  const controller = new AbortController();
  const signal = input.abort_signal ? AbortSignal.any([input.abort_signal, controller.signal]) : controller.signal;
  const deadline = performance.now() + recovery_timeout_ms;
  const budget_error = () => new ModelStreamFailure(create_model_timeout_error("recovery_budget").model_error, false);
  const timer = setTimeout(() => controller.abort(create_model_timeout_error("recovery_budget")), recovery_timeout_ms);
  timer.unref();
  /** 通知也受恢复生命周期约束，日志或订阅端阻塞不能延长模型恢复预算。 */
  const report_failure = async (failure: ModelStreamFailure, attempt: number, can_retry: boolean, next_retry_at_ms?: number): Promise<void> => {
    const pending = Promise.resolve().then(() => input.on_failure?.({
      request_kind: input.request_kind, ...read_model_error(failure)!, message: failure.message,
      attempt, max_attempts: can_retry ? MAX_MODEL_REQUEST_ATTEMPTS : attempt, will_retry: can_retry,
      ...(can_retry ? { next_retry_at_ms } : {}),
    }, failure)).catch(() => { /* 诊断失败不能覆盖真实失败。 */ });
    if (signal.aborted) return;
    let on_abort: () => void = () => {};
    const interrupted = new Promise<void>((resolve) => { on_abort = resolve; });
    signal.addEventListener("abort", on_abort, { once: true });
    try { await Promise.race([pending, interrupted]); }
    finally { signal.removeEventListener("abort", on_abort); }
  };
  try {
    for (let attempt = 1; attempt <= MAX_MODEL_REQUEST_ATTEMPTS; attempt += 1) {
      try {
        if (input.abort_signal?.aborted) throw new ModelStreamFailure({ code: "cancelled", message: "Model request cancelled", retryable: false }, false);
        if (performance.now() >= deadline) throw budget_error();
        return await input.execute_attempt(signal);
      } catch (caught) {
        if (!(caught instanceof ModelStreamFailure)) throw caught;
        const error = controller.signal.aborted && !input.abort_signal?.aborted
          ? new ModelStreamFailure(create_model_timeout_error("recovery_budget").model_error, caught.has_partial_output)
          : caught;
        const eligible_for_retry = !signal.aborted && is_retryable_empty_model_stream_failure(error)
          && (input.should_retry?.(error) ?? true);
        const retry_delay_ms = error.retry_at_ms !== undefined
          ? Math.max(0, error.retry_at_ms - Date.now()) : resolve_model_request_retry_delay(attempt);
        const next_retry_at_ms = error.retry_at_ms ?? Date.now() + retry_delay_ms;
        const retry_fits_budget = retry_delay_ms < deadline - performance.now();
        const attempts_remaining = attempt < MAX_MODEL_REQUEST_ATTEMPTS;
        const can_retry = eligible_for_retry && attempts_remaining && retry_fits_budget;
        // 无法遵守上游等待建议时立即以预算不足收口，绝不提前重发。
        const failure = eligible_for_retry && attempts_remaining && !retry_fits_budget ? budget_error() : error;
        if (failure.code !== "cancelled" && !input.abort_signal?.aborted) {
          await report_failure(failure, attempt, can_retry, next_retry_at_ms);
        }
        if (!can_retry) throw failure;
        try {
          // 通知本身可能耗时，等待绝对截止而非再次等待完整延迟。
          await wait_for_model_request_retry(Math.max(0, next_retry_at_ms - Date.now()), signal);
        } catch (error) {
          if (!input.abort_signal?.aborted && controller.signal.aborted) {
            const failure = budget_error();
            await report_failure(failure, attempt, false);
            throw failure;
          }
          throw error;
        }
      }
    }
    throw new Error("Model request retry state is invalid");
  } finally {
    clearTimeout(timer);
  }
}

/** 固定退避序列叠加 ±10% 抖动，避免并发请求同时冲击上游。 */
function resolve_model_request_retry_delay(retry_count: number): number {
  const base_ms = MODEL_REQUEST_RETRY_DELAYS_MS[retry_count - 1] ?? MODEL_REQUEST_RETRY_DELAYS_MS.at(-1)!;
  return Math.round(base_ms * (0.9 + Math.random() * 0.2));
}

/** 等待下一次模型请求，用户取消或恢复预算耗尽时立即清理计时器。 */
async function wait_for_model_request_retry(delay_ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const on_abort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", on_abort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", on_abort);
      resolve();
    }, delay_ms);
    signal.addEventListener("abort", on_abort, { once: true });
  });
}
