/**
 * City HTTP 路由认证策略。
 *
 * 关键点（中文）
 * - 只有显式声明的公开路由可以匿名访问。
 * - 其余路由统一要求当前 Agent 的 Bearer Token，不再做细粒度权限判断。
 */

import type { MiddlewareHandler } from "hono";
import { isAuthError } from "@/city/runtime/auth/AuthError.js";
import type { AuthService } from "@/city/runtime/auth/AuthService.js";
import {
  AUTH_PRINCIPAL_CONTEXT_KEY,
  type AuthMiddlewareVariables,
} from "@/city/runtime/auth/AuthMiddleware.js";

/** 单条路由认证策略。 */
export interface RouteAuthPolicy {
  /** 路径或以星号结尾的路径前缀。 */
  path: string;
  /** HTTP 方法，星号表示全部方法。 */
  method: string;
  /** 是否要求当前 Agent Bearer Token。 */
  require_auth: boolean;
}

/** Agent Server 路由策略；未匹配路由默认要求认证。 */
export const SERVER_AUTH_ROUTE_POLICIES: RouteAuthPolicy[] = [
  { path: "/health", method: "GET", require_auth: false },
  { path: "*", method: "*", require_auth: true },
];

/** City Gateway 路由策略；未匹配路由默认要求认证。 */
export const GATEWAY_AUTH_ROUTE_POLICIES: RouteAuthPolicy[] = [
  { path: "/health", method: "GET", require_auth: false },
  { path: "*", method: "*", require_auth: true },
];

/** 根据路径与方法返回第一条匹配策略。 */
export function resolveAuthRoutePolicy(
  path: string,
  method: string,
  policies: RouteAuthPolicy[],
): RouteAuthPolicy | null {
  const normalized_path = String(path || "").trim() || "/";
  const normalized_method = String(method || "GET").trim().toUpperCase();
  for (const policy of policies) {
    const expected_method = String(policy.method || "*").trim().toUpperCase();
    if (expected_method !== "*" && expected_method !== normalized_method) continue;
    const pattern = String(policy.path || "").trim();
    const matches = pattern === "*"
      || (pattern.endsWith("*")
        ? normalized_path.startsWith(pattern.slice(0, -1))
        : normalized_path === pattern);
    if (matches) return policy;
  }
  return null;
}

/** 创建只区分公开与已认证的全局路由守卫。 */
export function createRouteAuthGuardMiddleware(
  auth_service: AuthService,
  policies: RouteAuthPolicy[] = SERVER_AUTH_ROUTE_POLICIES,
): MiddlewareHandler<{ Variables: AuthMiddlewareVariables }> {
  return async (context, next) => {
    const policy = resolveAuthRoutePolicy(context.req.path, context.req.method, policies);
    if (policy?.require_auth === false) {
      await next();
      return;
    }
    try {
      const principal = auth_service.authenticate_bearer_header(
        context.req.header("authorization"),
      );
      context.set(AUTH_PRINCIPAL_CONTEXT_KEY, principal);
      await next();
    } catch (error) {
      if (isAuthError(error)) {
        return context.json({ success: false, error: error.message }, error.status);
      }
      return context.json({ success: false, error: String(error) }, 500);
    }
  };
}
