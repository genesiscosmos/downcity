/**
 * Auth API 路由。
 *
 * 关键点（中文）
 * - 本模块只承接 Bearer Token 模型下的最小认证接口。
 * - 路由层不做领域判断，所有业务逻辑统一委托给 `AuthService`。
 */

import { Hono, type Context } from "hono";
import type { AuthService } from "@/city/runtime/auth/AuthService.js";
import { AuthService as DefaultAuthService } from "@/city/runtime/auth/AuthService.js";
import { isAuthError } from "@/city/runtime/auth/AuthError.js";
import {
  createRequireAuthMiddleware,
  getAuthPrincipal,
  type AuthMiddlewareVariables,
} from "@/city/runtime/auth/AuthMiddleware.js";

/**
 * 注册 auth 路由。
 */
export function registerAuthRoutes(params: {
  app: Hono;
  authService?: AuthService;
}): void {
  const authService = params.authService || new DefaultAuthService();
  const router = new Hono();
  const protectedRouter = new Hono<{ Variables: AuthMiddlewareVariables }>();
  const require_auth = createRequireAuthMiddleware(authService);

  router.get("/status", (c) => {
    const initialized = authService.hasLocalCliAccess();
    return c.json({
      success: true,
      initialized,
      requireToken: initialized,
    });
  });

  protectedRouter.get("/me", require_auth, (c) => {
    const principal = getAuthPrincipal(c);
    return c.json({
      success: true,
      user: authService.getCurrentUser(principal),
    });
  });

  protectedRouter.get("/token/list", require_auth, (c) => {
    const principal = getAuthPrincipal(c);
    return c.json({
      success: true,
      tokens: authService.listTokens(principal),
    });
  });

  protectedRouter.post("/token/create", require_auth, async (c) => {
    try {
      const principal = getAuthPrincipal(c);
      const body = (await c.req.json().catch(() => ({}))) as {
        name?: string;
        expires_at?: string;
      };
      return c.json({
        success: true,
        token: authService.createToken(principal, {
          name: String(body.name || ""),
          expires_at: typeof body.expires_at === "string" ? body.expires_at : undefined,
        }),
      });
    } catch (error) {
      return toErrorResponse(c, error);
    }
  });

  protectedRouter.post("/token/delete", require_auth, async (c) => {
    try {
      const principal = getAuthPrincipal(c);
      const body = (await c.req.json().catch(() => ({}))) as {
        token_id?: string;
      };
      authService.deleteToken(principal, String(body.token_id || ""));
      return c.json({ success: true });
    } catch (error) {
      return toErrorResponse(c, error);
    }
  });

  router.route("/", protectedRouter);
  params.app.route("/api/auth", router);
}

function toErrorResponse(c: Context, error: unknown) {
  if (isAuthError(error)) {
    return c.json(
      { success: false, error: error.message },
      error.status as 200,
    );
  }
  return c.json({ success: false, error: String(error) }, 500);
}
