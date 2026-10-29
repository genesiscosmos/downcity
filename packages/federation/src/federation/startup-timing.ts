/** 启动阶段计时；观测回调失败不影响 Federation 的初始化结果。 */
import type { FederationStartupTiming } from "./types.js";

/** 执行并测量一个启动阶段，保留原始执行异常。 */
export async function measure_startup<T>(
  phase: string,
  run: () => Promise<T>,
  report?: (event: FederationStartupTiming) => void,
): Promise<T> {
  const started_at = performance.now();
  let ok = false;
  try {
    const result = await run();
    ok = true;
    return result;
  } finally {
    try {
      report?.({ phase, duration_ms: performance.now() - started_at, ok });
    } catch {
      // 观测设施不得改变业务执行结果。
    }
  }
}
