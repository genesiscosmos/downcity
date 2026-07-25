/**
 * 统一账户路由策略与全局守卫。
 *
 * 关键点（中文）
 * - 这里负责把“哪些接口需要登录、需要什么权限”集中配置。
 * - 未匹配到公开策略的接口默认要求认证，避免新路由绕过鉴权。
 */

import type { MiddlewareHandler } from "hono";
import type { AuthRoutePolicy, AuthPermissionKey } from "@downcity/type";
import { isAuthError as isAuthDomainError } from "@/city/runtime/auth/AuthError.js";
import type { AuthService } from "@/city/runtime/auth/AuthService.js";
import { AUTH_PRINCIPAL_CONTEXT_KEY, type AuthMiddlewareVariables } from "@/city/runtime/auth/AuthMiddleware.js";

/**
 * Server 侧路由权限矩阵。
 */
export const SERVER_AUTH_ROUTE_POLICIES: AuthRoutePolicy[] = [
  { path: "/api/auth/*", method: "*", require_auth: false },
  { path: "/health", method: "GET", require_auth: false },
  {
    path: "/api/execute",
    method: "POST",
    require_auth: true,
    any_permissions: ["agent.execute"],
  },
  {
    path: "/api/plugins/list",
    method: "GET",
    require_auth: true,
    any_permissions: ["plugin.read"],
  },
  {
    path: "/api/plugins/control",
    method: "POST",
    require_auth: true,
    any_permissions: ["plugin.write"],
  },
  {
    path: "/api/plugins/command",
    method: "POST",
    require_auth: true,
    any_permissions: ["plugin.write"],
  },
  {
    path: "/api/plugins/catalog",
    method: "GET",
    require_auth: true,
    any_permissions: ["plugin.read"],
  },
  {
    path: "/api/plugins/availability",
    method: "POST",
    require_auth: true,
    any_permissions: ["plugin.read"],
  },
  {
    path: "/api/plugins/action",
    method: "POST",
    require_auth: true,
    any_permissions: ["plugin.write"],
  },
  {
    path: "/api/control/chat/access",
    method: "GET",
    require_auth: true,
    any_permissions: ["plugin.read"],
  },
  {
    path: "/api/control/chat/access/*",
    method: "POST",
    require_auth: true,
    any_permissions: ["plugin.write"],
  },
  {
    path: "/api/control/chat/access/*",
    method: "DELETE",
    require_auth: true,
    any_permissions: ["plugin.write"],
  },
  {
    path: "/api/control/*",
    method: "*",
    require_auth: true,
  },
  { path: "*", method: "*", require_auth: true },
];

/**
 * 控制面网关侧路由权限矩阵。
 */
export const GATEWAY_AUTH_ROUTE_POLICIES: AuthRoutePolicy[] = [
  { path: "/api/auth/*", method: "*", require_auth: false },
  { path: "/health", method: "GET", require_auth: false },
  {
    path: "/agents/*",
    method: "*",
    require_auth: true,
    any_permissions: ["agent.execute"],
  },
  {
    path: "/api/ui/agents",
    method: "GET",
    require_auth: true,
    any_permissions: ["agent.read"],
  },
  {
    path: "/api/ui/agents/create",
    method: "POST",
    require_auth: true,
    any_permissions: ["agent.write"],
  },
  {
    path: "/api/ui/agents/start",
    method: "POST",
    require_auth: true,
    any_permissions: ["agent.write"],
  },
  {
    path: "/api/ui/agents/restart",
    method: "POST",
    require_auth: true,
    any_permissions: ["agent.write"],
  },
  {
    path: "/api/ui/agents/stop",
    method: "POST",
    require_auth: true,
    any_permissions: ["agent.write"],
  },
  {
    path: "/api/ui/model*",
    method: "*",
    require_auth: true,
    any_permissions: ["model.read"],
  },
  {
    path: "/api/ui/env*",
    method: "*",
    require_auth: true,
    any_permissions: ["env.read"],
  },
  {
    path: "/api/ui/channel*",
    method: "*",
    require_auth: true,
    any_permissions: ["channel.read"],
  },
  {
    path: "/api/ui/plugins*",
    method: "*",
    require_auth: true,
    any_permissions: ["plugin.read"],
  },
  {
    path: "/api/ui/*",
    method: "*",
    require_auth: true,
  },
];

/**
 * 根据路径与方法解析匹配的策略。
 */
export function resolveAuthRoutePolicy(
  path: string,
  method: string,
  policies: AuthRoutePolicy[],
): AuthRoutePolicy | null {
  const normalizedPath = String(path || "").trim() || "/";
  const normalizedMethod = String(method || "GET").trim().toUpperCase();
  for (const policy of policies) {
    if (!matchesMethod(policy.method, normalizedMethod)) continue;
    if (!matchesPath(policy.path, normalizedPath)) continue;
    return policy;
  }
  return null;
}

/**
 * 创建全局路由鉴权中间件。
 */
export function createRouteAuthGuardMiddleware(
  authService: AuthService,
  policies: AuthRoutePolicy[] = SERVER_AUTH_ROUTE_POLICIES,
): MiddlewareHandler<{ Variables: AuthMiddlewareVariables }> {
  return async (c, next) => {
    const policy = resolveAuthRoutePolicy(c.req.path, c.req.method, policies);
    if (!policy || policy.require_auth !== true) {
      await next();
      return;
    }
    try {
      const principal = authService.authenticateBearerHeader(
        c.req.header("authorization"),
      );
      ensurePermissions(principal.permissions, policy.any_permissions);
      c.set(AUTH_PRINCIPAL_CONTEXT_KEY, principal);
      await next();
    } catch (error) {
      if (isRouteGuardError(error)) {
        return c.json(
          { success: false, error: error.message },
          error.status as 200,
        );
      }
      return c.json({ success: false, error: String(error) }, 500);
    }
  };
}

function matchesMethod(expectedMethod: string, actualMethod: string): boolean {
  const expected = String(expectedMethod || "*").trim().toUpperCase();
  return expected === "*" || expected === actualMethod;
}

function matchesPath(patternInput: string, actualPath: string): boolean {
  const pattern = String(patternInput || "").trim();
  if (!pattern) return false;
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return actualPath.startsWith(prefix);
  }
  return actualPath === pattern;
}

function ensurePermissions(
  userPermissions: AuthPermissionKey[],
  any_permissions: AuthRoutePolicy["any_permissions"],
): void {
  if (!any_permissions || any_permissions.length === 0) return;
  if (any_permissions.some((permission) => userPermissions.includes(permission))) return;
  throw new ErrorWithStatus("Permission denied", 403);
}

class ErrorWithStatus extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthPermissionError";
    this.status = status;
  }
}

function isAuthErrorLike(error: unknown): error is { message: string; status: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

function isRouteGuardError(error: unknown): error is { message: string; status: number } {
  return isAuthDomainError(error) || isAuthErrorLike(error);
}
