/**
 * Federation middleware 执行模块。
 *
 * 负责把 `fed.middle()` 注册的 HTTP middleware 组合成单次请求执行链。
 * 该模块保持纯执行语义，不包含任何具体安全策略。
 */

import type {
  FederationMiddleware,
  FederationMiddlewareContext,
  FederationMiddlewareNext,
} from "../types/FederationMiddleware.js";

/**
 * 执行 Federation HTTP middleware 链。
 *
 * 关键说明（中文）
 * - middleware 按注册顺序进入，按相反顺序退出。
 * - 未调用 `next()` 时即为短路返回。
 * - 同一个 middleware 里重复调用 `next()` 会抛错。
 */
export async function run_federation_middlewares(
  middlewares: readonly FederationMiddleware[],
  ctx: FederationMiddlewareContext,
  terminal: FederationMiddlewareNext,
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
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({
      error: {
        message,
        type: "middleware_error",
      },
    }, { status: 500 });
  }
}
