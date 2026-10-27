/**
 * Accounts 服务 HTTP 路由。
 *
 * 本模块只负责解析公开协议、选择 HTTP 状态并调用 AccountsRuntime；Provider、
 * 认证和持久化规则均由运行时负责。
 */

import type { ServiceInstallContext } from "@downcity/federation";
import type { AccountsRuntime } from "./AccountsRuntime.js";
import { register_login_routes } from "./login-routes.js";

/** 注册 AccountsService 的全部公开与管理端路由。 */
export function register_accounts_routes(
  runtime: AccountsRuntime,
  ctx: ServiceInstallContext,
): void {
  register_login_routes(runtime, ctx);

  ctx.route({
    method: "ALL",
    path: "/auth/*",
    public: true,
    handler: {
      request: (request) => runtime.get_auth_handler()(request),
    },
  });

  ctx.route({
    method: "GET",
    path: "/oauth/callback",
    public: true,
    handler: {
      request: (request) => runtime.handle_oauth_callback(request),
    },
  });

  ctx.route({
    method: "POST",
    path: "/register",
    public: true,
    handler: async (request_ctx) => {
      const result = await runtime.register_email_account(
        await request_ctx.json<{ email?: string; password?: string; name?: string }>(),
      );
      return request_ctx.jsonResponse(result.body, result.status);
    },
  });

  ctx.route({
    method: "POST",
    path: "/verify-email",
    public: true,
    handler: async (request_ctx) => {
      const result = await runtime.verify_email_account(
        ctx,
        await request_ctx.json<{ token?: string; bureau_id?: string }>(),
      );
      return request_ctx.jsonResponse(result.body, result.status);
    },
  });

  ctx.route({
    method: "GET",
    path: "/providers",
    public: true,
    handler: async (request_ctx) => request_ctx.jsonResponse({
      items: runtime.list_visible_providers(),
    }),
  });

  ctx.route({
    method: "GET",
    path: "/me",
    auth: ["user"],
    handler: async (request_ctx) => {
      const user_id = String(request_ctx.user?.user_id ?? "");
      return request_ctx.jsonResponse({
        user: {
          ...request_ctx.user,
          bureau_id: request_ctx.bureau?.bureau_id,
        },
        profile: user_id ? await runtime.read_profile(user_id) : null,
      });
    },
  });

  ctx.route({
    method: "POST",
    path: "/tokens/issue",
    auth: ["admin"],
    handler: async (request_ctx) => {
      const body = await request_ctx.json<{
        bureau_id?: string;
        user_id?: string;
        metadata?: Record<string, unknown>;
        ttl?: string | number;
      }>();
      const bureau_id = typeof body.bureau_id === "string" ? body.bureau_id : "";
      const user_id = String(body.user_id ?? "").trim();
      if (!user_id) return request_ctx.jsonResponse({ error: "user_id required" }, 400);
      await runtime.require_active_bureau(bureau_id);
      return request_ctx.jsonResponse(await ctx.createUserToken({
        bureau_id,
        user_id,
        metadata: body.metadata,
        ttl: body.ttl ?? runtime.read_token_ttl(),
      }));
    },
  });

  ctx.route({
    method: "POST",
    path: "/logout",
    auth: ["user"],
    handler: async (request_ctx) => {
      const authorization = request_ctx.request.headers.get("authorization") ?? "";
      const token = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
      if (!token) return request_ctx.jsonResponse({ error: "Bearer user token required" }, 401);
      await ctx.revoke_user_token(token);
      return request_ctx.jsonResponse({ success: true });
    },
  });

  ctx.route({
    method: "GET",
    path: "/users",
    auth: ["admin"],
    handler: async (request_ctx) => {
      try {
        return request_ctx.jsonResponse({ items: await runtime.list_account_users() });
      } catch {
        return request_ctx.jsonResponse({ items: [] });
      }
    },
  });

  ctx.route({
    method: "GET",
    path: "/sessions",
    auth: ["admin"],
    handler: async (request_ctx) => {
      try {
        return request_ctx.jsonResponse({ items: await runtime.list_account_sessions() });
      } catch {
        return request_ctx.jsonResponse({ items: [] });
      }
    },
  });
}
