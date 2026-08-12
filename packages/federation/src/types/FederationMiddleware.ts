/**
 * Federation HTTP Middleware 类型模块。
 *
 * 定义 `fed.middle()` 使用的中间件上下文与 next 函数。该层只约束
 * Federation 级 HTTP middleware 的接入接口，具体 CORS、安全响应头、
 * 限流、超时等策略实现由调用方按自己的运行环境提供。
 */

import type { Service } from "../service/service.js";
import type { Runtime } from "../federation/runtime.js";
import type { FederationRequestExecutionContext } from "../federation/types.js";

/**
 * Federation middleware 的后续执行函数。
 *
 * 关键说明（中文）
 * - 调用 `next()` 会进入下一个 middleware 或最终的内部 router。
 * - 每个 middleware 中的 `next()` 最多只能调用一次。
 */
export type FederationMiddlewareNext = () => Promise<Response>;

/**
 * Federation HTTP middleware 函数。
 *
 * 关键说明（中文）
 * - 返回 `Response` 可以短路请求。
 * - `await next()` 后可以对响应 headers 做后处理。
 * - middleware 运行在内部 Hono router 之前，因此可在 body 读取前拒绝请求。
 */
export type FederationMiddleware = (
  ctx: FederationMiddlewareContext,
  next: FederationMiddlewareNext,
) => Promise<Response> | Response;

/**
 * 暴露给 middleware 的 Federation 只读引用。
 */
export interface FederationMiddlewareFederationRef {
  /** 返回当前 Federation 已注册的 Service 列表。 */
  services(): readonly Service[];
}

/**
 * Federation middleware 单次请求上下文。
 */
export interface FederationMiddlewareContext {
  /** 当前原始 HTTP 请求。 */
  request: Request;
  /** 宿主运行时的单次请求执行上下文。 */
  execution?: FederationRequestExecutionContext;
  /** 当前 Federation 的运行时能力集合。 */
  runtime: Runtime;
  /** 当前 Federation 的只读能力引用。 */
  federation: FederationMiddlewareFederationRef;
  /** middleware 之间共享的轻量临时上下文。 */
  locals: Record<string, unknown>;
}
