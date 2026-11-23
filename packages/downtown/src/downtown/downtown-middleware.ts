/**
 * Downtown middleware 执行模块。
 *
 * 负责把 `fed.middle()` 注册的 HTTP middleware 组合成单次请求执行链。
 * 该模块保持纯执行语义，不包含任何具体安全策略。
 */

import { build_error_response } from "./http/error-response.js";
import type {
  DowntownMiddleware,
  DowntownMiddlewareContext,
  DowntownMiddlewareNext,
} from "../types/DowntownMiddleware.js";

/**
 * 执行 Downtown HTTP middleware 链。
 *
 * 关键说明（中文）
 * - middleware 按注册顺序进入，按相反顺序退出。
 * - 未调用 `next()` 时即为短路返回。
 * - 同一个 middleware 里重复调用 `next()` 会抛错。
 */
export async function run_downtown_middlewares(
  middlewares: readonly DowntownMiddleware[],
  ctx: DowntownMiddlewareContext,
  terminal: DowntownMiddlewareNext,
): Promise<Response> {
  let index = -1;

  async function dispatch(current_index: number): Promise<Response> {
    if (current_index <= index) {
      throw new Error("next() called multiple times");
    }
    index = current_index;

    const middleware = middlewares[current_index];
    if (!middleware) {
      return terminal();
    }

    return await middleware(ctx, () => dispatch(current_index + 1));
  }

  try {
    return await dispatch(0);
  } catch (error) {
    return build_error_response(ctx.abort_signal.aborted ? ctx.abort_signal.reason : error, ctx.request_id);
  }
}
