/**
 * Accounts 服务 HTTP 路由。
 *
 * 本模块只负责解析公开协议、选择 HTTP 状态并调用 AccountsRuntime；Provider、
 * 认证和持久化规则均由运行时负责。
 */

import type { ServiceInstallContext } from "@downcity/federation";
import type { AccountsRuntime } from "./AccountsRuntime.js";
import { readOAuthProviderId } from "./oauth.js";
import type {
  AccountsLoginContinueRequest,
  AccountsLoginStartRequest,
} from "./types.js";
import { toRecord } from "./utils.js";

/** 注册 AccountsService 的全部公开与管理端路由。 */
export function register_accounts_routes(
  runtime: AccountsRuntime,
  ctx: ServiceInstallContext,
): void {
  ctx.route({
    method: "POST",
    path: "/login/start",
    public: true,
    handler: async (request_ctx) => {
      const body = await request_ctx.json<AccountsLoginStartRequest>();
      const provider = String(body.provider ?? "").trim();
      const bureau_id = typeof body.bureau_id === "string" ? body.bureau_id : "";
      if (!provider) return request_ctx.jsonResponse({ error: "provider required" }, 400);
      await runtime.require_active_bureau(bureau_id);

      if (provider === "local") {
        if (!runtime.is_local_login_enabled()) {
          return request_ctx.jsonResponse({ error: "local login is not enabled" }, 404);
        }
        return request_ctx.jsonResponse(await runtime.start_local_login(ctx, bureau_id));
      }
      if (provider === "email") {
        const result = await runtime.start_email_login(bureau_id);
        return "error" in result
          ? request_ctx.jsonResponse({ error: result.error }, result.status)
          : request_ctx.jsonResponse(result.data);
      }
      const oauth_provider = readOAuthProviderId(provider);
      if (!oauth_provider) {
        return request_ctx.jsonResponse({ error: "provider not supported" }, 400);
      }
      const result = await runtime.create_oauth_start_result(bureau_id, oauth_provider);
      return "error" in result
        ? request_ctx.jsonResponse({ error: result.error }, result.status)
        : request_ctx.jsonResponse(result.data);
    },
  });

  ctx.route({
    method: "POST",
    path: "/login/continue",
    public: true,
    handler: async (request_ctx) => {
      const body = await request_ctx.json<AccountsLoginContinueRequest>();
      const login_id = String(body.login_id ?? "").trim();
      if (!login_id) return request_ctx.jsonResponse({ error: "login_id required" }, 400);
      const entry = await runtime.read_login_state(login_id);
      if (!entry) return request_ctx.jsonResponse({ error: "login expired or invalid" }, 404);

      if (entry.provider === "email") {
        const input = toRecord(body.input);
        const result = await runtime.create_email_login_token(ctx, {
          email: input ? String(input.email ?? "") : "",
          password: input ? String(input.password ?? "") : "",
          bureau_id: entry.bureau_id,
        });
        if ("error" in result) {
          return request_ctx.jsonResponse({ error: result.error }, result.status);
        }
        await runtime.resolve_login_state(login_id, result.user_token);
        return request_ctx.jsonResponse({
          status: "done",
          login_id,
          provider: "email",
        });
      }
      if (entry.provider === "local") {
        return request_ctx.jsonResponse({
          status: entry.user_token ? "done" : "pending",
          login_id,
          provider: "local",
        });
      }
      return request_ctx.jsonResponse({ error: "login does not accept input" }, 400);
    },
  });

  ctx.route({
    method: "GET",
    path: "/login/result",
    public: true,
    handler: async (request_ctx) => {
      const login_id = String(
        new URL(request_ctx.request.url).searchParams.get("login_id") ?? "",
      ).trim();
      if (!login_id) return request_ctx.jsonResponse({ error: "login_id required" }, 400);
      const result = await runtime.read_login_result(login_id);
      return "error" in result
        ? request_ctx.jsonResponse({ error: result.error }, result.status)
        : request_ctx.jsonResponse(result.data);
    },
  });

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
    handler: async (request_ctx) => request_ctx.jsonResponse({ success: true }),
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
