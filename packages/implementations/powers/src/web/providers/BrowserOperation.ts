/**
 * 浏览器操作的完整期限与取消边界。
 *
 * 关键点（中文）：期限覆盖初始化、页面创建和观察的全部等待；取消只结束当前操作，
 * 页面资源由 Provider 回收。迟到 Promise 始终被消费，避免取消后产生未处理拒绝。
 */

/** 归一化浏览器完整操作的期限，与浏览器配置保持相同范围。 */
export function browser_timeout_ms(value?: number): number {
  return Number.isFinite(value) ? Math.min(60_000, Math.max(1_000, Math.floor(value ?? 30_000))) : 30_000;
}

/** 等待异步操作或取消信号；调用方负责在取消时回收该操作拥有的资源。 */
export async function wait_for_browser<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void pending.catch(() => undefined);
    signal.throwIfAborted();
  }
  let on_abort: () => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    on_abort = () => reject(signal.reason);
    signal.addEventListener("abort", on_abort, { once: true });
  });
  try {
    const result = await Promise.race([pending, interrupted]);
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener("abort", on_abort);
  }
}

/** 在统一期限内执行浏览器操作，并向全部子步骤传播同一个取消信号。 */
export async function run_browser_operation<T>(
  timeout_ms: number | undefined,
  upstream_signal: AbortSignal | undefined,
  execute: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  upstream_signal?.throwIfAborted();
  const controller = new AbortController();
  const signal = upstream_signal ? AbortSignal.any([upstream_signal, controller.signal]) : controller.signal;
  const duration_ms = browser_timeout_ms(timeout_ms);
  const timer = setTimeout(() => controller.abort(new Error(`Browser operation timed out after ${duration_ms} ms`)), duration_ms);
  try {
    return await wait_for_browser(execute(signal), signal);
  } finally {
    clearTimeout(timer);
  }
}
