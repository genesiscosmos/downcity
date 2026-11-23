/**
 * Downtown HTTP Middleware 类型模块。
 *
 * 定义 `fed.middle()` 使用的中间件上下文与 next 函数。该层只约束
 * Downtown 级 HTTP middleware 的接入接口，具体 CORS、安全响应头、
 * 限流、超时等策略实现由调用方按自己的运行环境提供。
 */

import type { Service } from "../service/service.js";
import type { Runtime } from "../downtown/runtime.js";
import type { DowntownRequestExecutionContext } from "../downtown/types.js";

/**
 * Downtown middleware 的后续执行函数。
 *
 * 关键说明（中文）
 * - 调用 `next()` 会进入下一个 middleware 或最终的内部 router。
 * - 每个 middleware 中的 `next()` 最多只能调用一次。
 */
export type DowntownMiddlewareNext = () => Promise<Response>;

/**
 * Downtown HTTP middleware 函数。
 *
 * 关键说明（中文）
 * - 返回 `Response` 可以短路请求。
 * - `await next()` 后可以对响应 headers 做后处理。
 * - middleware 运行在内部 Hono router 之前，因此可在 body 读取前拒绝请求。
 */
export type DowntownMiddleware = (
  ctx: DowntownMiddlewareContext,
  next: DowntownMiddlewareNext,
) => Promise<Response> | Response;

/**
 * 暴露给 middleware 的 Downtown 只读引用。
 */
export interface DowntownMiddlewareDowntownRef {
  /** 返回当前 Downtown 已注册的 Service 列表。 */
  services(): readonly Service[];
}

/**
 * Downtown middleware 单次请求上下文。
 */
export interface DowntownMiddlewareContext {
  /** 当前原始 HTTP 请求。 */
  request: Request;
  /** Downtown HTTP 边界生成的请求关联 ID，middleware 短路响应同样使用它。 */
  request_id: string;
  /** 当前前台请求的组合取消信号；不能视为数据库事务回滚保证。 */
  abort_signal: AbortSignal;
  /** 宿主运行时的单次请求执行上下文。 */
  execution?: DowntownRequestExecutionContext;
  /** 当前 Downtown 的运行时能力集合。 */
  runtime: Runtime;
  /** 当前 Downtown 的只读能力引用。 */
  downtown: DowntownMiddlewareDowntownRef;
  /** middleware 之间共享的轻量临时上下文。 */
  locals: Record<string, unknown>;
}
