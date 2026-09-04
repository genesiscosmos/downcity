/**
 * Auth 中间件。
 *
 * 关键点（中文）
 * - 当前先服务 `/api/auth/*` 的受保护子路由。
 * - 后续把更多控制面路由切到 Bearer 鉴权时，可直接复用这一层。
 */

import type { Context, MiddlewareHandler } from "hono";
import type { AgentTokenPrincipal } from "@/city/types/auth/AgentToken.js";
import { isAuthError } from "@/city/runtime/auth/AuthError.js";
import type { AuthService } from "@/city/runtime/auth/AuthService.js";

/**
 * Hono Context 中保存 principal 的 key。
 */
export const AUTH_PRINCIPAL_CONTEXT_KEY = "authPrincipal";

/**
 * Auth 中间件变量映射。
 */
export interface AuthMiddlewareVariables {
  /**
   * 当前请求的认证主体。
   */
  authPrincipal: AgentTokenPrincipal;
}

/**
 * 生成 Bearer 鉴权中间件。
 */
export function createRequireAuthMiddleware(
  authService: AuthService,
): MiddlewareHandler<{ Variables: AuthMiddlewareVariables }> {
  return async (c, next) => {
    try {
      const principal = authService.authenticate_bearer_header(
      c.req.header("authorization"),
      );
      c.set(AUTH_PRINCIPAL_CONTEXT_KEY, principal);
      await next();
    } catch (error) {
     if (isAuthError(error)) {
       return c.json(
         { success: false, error: error.message },
          error.status,
       );
     }
      return c.json({ success: false, error: String(error) }, 500);
    }
  };
}

/**
 * 从 Context 中读取 principal。
 */
export function getAuthPrincipal(
  context: Context<{ Variables: AuthMiddlewareVariables }>,
): AgentTokenPrincipal {
  return context.get(AUTH_PRINCIPAL_CONTEXT_KEY);
}
