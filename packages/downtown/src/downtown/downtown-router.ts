/**
 * Downtown 路由构建模块。
 *
 * 负责把 service/action 暴露为 Hono 路由，并统一处理：
 * - 请求身份解析
 * - ctx 组装
 * - hook 调度
 * - 公共管理接口
 */

import { Hono } from "hono";
import type { Handler } from "hono";
import type { CityTableApi } from "../store/table-api.js";
import type { Service, Context, ServiceRouteMethod } from "../service/service.js";
import { InstallableService } from "../service/installable-service.js";
import { httpError } from "../utils/helpers.js";
import type { Authenticator } from "./auth/authenticator.js";
import type { DowntownAdminStore } from "./auth/admin-store.js";
import { bearerToken } from "../utils/helpers.js";
import type { DowntownAdminLoginInput } from "./auth/types.js";
import type { Runtime } from "./runtime.js";
import type { RuntimeUser } from "./auth/types.js";
import { build_downtown_instruction } from "./downtown-instruction.js";
import { list_service_catalog, get_service_catalog_detail } from "./service-catalog.js";
import { build_service_openapi } from "./service-openapi.js";
import { collect_downtown_env_catalog } from "./downtown-env-catalog.js";
import type { DowntownRequestTransport, DowntownTrustedIdentity } from "./types.js";
import { AIService } from "../service/ai/ai-service.js";
import { parse_action_input, read_request_text } from "./http/request-input.js";
import { build_error_response as format_http_error, log_http_failure } from "./http/error-response.js";

declare module "hono" {
  interface ContextVariableMap {
    /** 服务端为本次 HTTP 请求生成的关联 ID，不能由调用方覆盖。 */
    downtown_request_id: string;
    identity?: { kind: "guest" | "user" | "admin" };
    user?: RuntimeUser;
  }
}

/**
 * Downtown router 在单次请求里接收的进程内变量。
 */
interface DowntownRouterEnv {
  /** Downtown HTTP 执行边界生成的请求 ID，仅来自进程内绑定。 */
  downtown_request_id?: string;
  /** 前台执行期限与客户端取消组合的信号。 */
  abort_signal?: AbortSignal;
  /** 由 `Downtown.fetch()` 传入的进程内可信身份。 */
  trusted_identity?: DowntownTrustedIdentity;
  /** 当前请求来源 transport。 */
  transport?: DowntownRequestTransport;
}

/**
 * 构建 Downtown 对外路由。
 */
export function build_downtown_router(params: {
  /** runtime 能力 */
  runtime: Runtime;
  /** 已注册服务 */
  services: Service[];
  /** 鉴权器 */
  authenticator: Authenticator;
  /** 表映射 */
  table_map: Map<string, CityTableApi>;
  /** Downtown 管理员身份与会话 Store。 */
  admin_store: DowntownAdminStore;
  /** 当前队列是否已配置。 */
  queue_available: () => boolean;
}): Hono {
  const { runtime, services, authenticator, table_map, admin_store } = params;
  const app = new Hono();
  app.use("*", async (c, next) => {
    const request_id = (c.env as DowntownRouterEnv | undefined)?.downtown_request_id ?? `req_${crypto.randomUUID()}`;
    c.set("downtown_request_id", request_id);
    await next();
    // Hono 会克隆已完成响应的 headers；不消费正文，也不会被旧响应头反向覆盖。
    c.header("x-request-id", request_id);
  });
  app.onError((error, c) => format_http_error(error, c.get("downtown_request_id")));
  app.notFound((c) => format_http_error(httpError(404, "Route not found"), c.get("downtown_request_id")));

  app.get("/health", (c) => c.json({
    ok: true,
    name: "downcity",
    queue: params.queue_available(),
    checked_at: new Date().toISOString(),
    services: services.map((service) => service.id),
    service_list: services.map((service) => ({ id: service.id, name: service.name })),
  }));

  app.get("/.well-known/downcity.json", (c) => {
    const origin = new URL(c.req.raw.url).origin;
    return c.json(authenticator.get_discovery(origin), 200, {
      "cache-control": "public, max-age=300",
    });
  });

  app.get("/.well-known/jwks.json", async (c) => {
    try {
      return c.json(await authenticator.get_public_jwks(), 200, {
        "cache-control": "public, max-age=300",
      });
    } catch (error) {
      return format_http_error(error, c.get("downtown_request_id"));
    }
  });

  // 新受保护请求的在线检查入口；只验证实际 Bearer，不使用进程内可信身份。
  // 每次查询持久化撤销状态，不缓存结果，也不干预已开始的流。
  app.get("/v1/downtown/token", async (c) => {
    try {
      const token = bearerToken(c.req.raw);
      if (!token) throw httpError(401, "Authentication required");
      const payload = await authenticator.verifyToken(token);
      return c.json({
        active: true,
        token_id: payload.jti,
        user_id: payload.user_id,
        expires_at: new Date(payload.exp * 1000).toISOString(),
      }, 200, no_store_headers());
    } catch (error) {
      const status_code = (error as { /** 已分类的凭证验证 HTTP 状态。 */ statusCode?: number }).statusCode;
      return with_no_store(format_http_error(status_code === 401
        ? httpError(401, "User token is inactive")
        : httpError(503, "Downtown token validity check unavailable"), c.get("downtown_request_id")));
    }
  });

  app.post("/v1/admin/login", async (c) => {
    try {
      const input = parse_action_input(await read_request_text(c.req.raw)) as unknown as DowntownAdminLoginInput;
      return c.json(await admin_store.login(input), 200, no_store_headers());
    } catch (error) {
      return with_no_store(format_http_error(error, c.get("downtown_request_id")));
    }
  });

  app.get("/v1/admin/session", async (c) => {
    try {
      const identity = await authorize_request(
        authenticator,
        trusted_identity_from_env(c.env),
        c.req.raw,
        ["admin"],
      );
      return c.json({
        authenticated: true,
        admin_id: identity.admin_id,
        session_id: identity.admin_session_id,
      }, 200, no_store_headers());
    } catch (error) {
      return with_no_store(format_http_error(error, c.get("downtown_request_id")));
    }
  });

  app.post("/v1/admin/logout", async (c) => {
    try {
      await authorize_request(authenticator, trusted_identity_from_env(c.env), c.req.raw, ["admin"]);
      const token = bearerToken(c.req.raw);
      if (token) await admin_store.logout(token);
      return c.json({ ok: true }, 200, no_store_headers());
    } catch (error) {
      return with_no_store(format_http_error(error, c.get("downtown_request_id")));
    }
  });

  app.use("/v1/*", async (c, next) => {
    // 关键说明（中文）
    // Downtown env 默认读取运行时内存 cache。
    // 管理端通过 /v1/env/upsert、/remove、/import 修改 env 时会自动更新当前 cache；
    // 如果直接改数据库，可通过 /v1/env/refresh 或 city CLI 手动刷新。
    sync_request_origin(services, new URL(c.req.raw.url).origin);
    await next();
  });

  app.get("/v1/services", async (c) => c.json({ items: await list_service_catalog(services) }, 200, no_store_headers()));

  app.get("/v1/services/:service_id", async (c) => {
    const detail = await get_service_catalog_detail(services, c.req.param("service_id"));
    if (!detail) return with_no_store(format_http_error(httpError(404, "Service not found"), c.get("downtown_request_id")));
    return c.json(detail, 200, no_store_headers());
  });

  app.get("/openapi.json", (c) => c.json(build_service_openapi(services, new URL(c.req.url).origin), 200, no_store_headers()));

  app.get("/v1/env/catalog", async (c) => {
    try {
      await authorize_request(authenticator, trusted_identity_from_env(c.env), c.req.raw, ["admin"]);

      return c.json({ items: collect_downtown_env_catalog(services, runtime.env) });
    } catch (error) {
      return format_http_error(error, c.get("downtown_request_id"));
    }
  });

  app.get("/v1/downtown/instruction", async (c) => {
    try {
      await authorize_request(authenticator, trusted_identity_from_env(c.env), c.req.raw, ["admin"]);

      return new Response(await build_downtown_instruction(services), {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    } catch (error) {
      return format_http_error(error, c.get("downtown_request_id"));
    }
  });

  for (const service of services) {
    for (const def of service._listNativeRouteDefs()) {
      const path = `/v1/${encodeURIComponent(service.id)}${def.path}`;
      register_native_route(app, def.method, path, async (c) => {
        try {
          if (def.auth.length > 0) {
            await authorize_request(authenticator, trusted_identity_from_env(c.env), c.req.raw, def.auth);
          }
          c.req.raw.signal.throwIfAborted();
          return await def.handler(c.req.raw);
        } catch (error) {
          return format_http_error(error, c.get("downtown_request_id"));
        }
      });
    }
  }

  for (const service of services) {
    for (const def of service._listActionDefs()) {
      const action = def.action;
      const path = `/v1/${encodeURIComponent(service.id)}/${action.id}`;
      const register = def.method === "GET" ? app.get.bind(app) : app.post.bind(app);

      const handler: Handler = async (c) => {
        const request_id = c.get("downtown_request_id");
        let raw_body: string | undefined;
        let city_id: string | undefined;
        let input: Record<string, unknown>;
        try {
          const source = c.req.raw.headers.get("x-downcity-city-id");
          if (source !== null && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(source)) {
            throw httpError(400, "Invalid city_id source label");
          }
          city_id = source ?? undefined;
          if (def.method === "GET") input = search_params_to_object(new URL(c.req.raw.url).searchParams);
          else {
            raw_body = await read_request_text(c.req.raw);
            input = def.body === "raw" ? {} : parse_action_input(raw_body);
          }
        } catch (error) { return format_http_error(error, request_id); }

        const db: Record<string, CityTableApi> = {};
        if (service.tables) {
          for (const name of Object.keys(service.tables)) {
            db[name] = table_map.get(`${service.id}.${name}`)!;
          }
        }

        const ctx: Context = {
          input,
          locals: { request_id },
          request_id,
          city_id,
          abort_signal: (c.env as DowntownRouterEnv | undefined)?.abort_signal ?? c.req.raw.signal,
          request: c.req.raw,
          raw_body,
          transport: transport_from_env(c.env),
          db,
          identity: { kind: "guest" },
          env: (key) => runtime.env.get(key),
          service: { id: service.id, name: service.name },
          action: { id: action.id },
          queue: service._queue,
          storage: runtime.storage ?? service._storage,
          started_at: new Date(),
        };
        try {
          const execution_context = c.executionCtx;
          ctx.waitUntil = (promise) => execution_context.waitUntil(promise);
        } catch {
          ctx.waitUntil = undefined;
        }

        if (service instanceof AIService && service.relay && ["chat/completions", "stream"].includes(action.id)) {
          // 授权或余额检查失败也返回可引用的请求标识，但不生成上游尝试或账单。
          ctx.locals.relay_request_id = request_id;
        }
        try {
          const token = bearerToken(c.req.raw);
          if (service instanceof AIService && service.relay && token?.startsWith("dck_") &&
            ["models", "chat/completions", "stream"].includes(action.id)) {
            // 调用凭据仅在白名单入口解析，保持 guest 身份，不能访问管理或账户 action。
            await service.relay.authorize(token, ctx);
          } else {
            const identity = await authorize_request(authenticator, trusted_identity_from_env(c.env), c.req.raw, def.auth);
            ctx.identity = { kind: identity.level };
            ctx.user = identity.user;
          }

          for (const hook of global_service_hooks(services)) {
            ctx.abort_signal?.throwIfAborted();
            await hook.runBefore(ctx);
          }
          ctx.abort_signal?.throwIfAborted();
          await action.hook.runBefore(ctx);
          ctx.abort_signal?.throwIfAborted();
          await service.hook.runBefore(ctx);
          ctx.abort_signal?.throwIfAborted();

          const output = await action.run(ctx);
          ctx.output = output;
          ctx.ended_at = new Date();

          await service.hook.runAfter(ctx);
          await action.hook.runAfter(ctx);
          for (const hook of global_service_hooks(services)) {
            await hook.runAfter(ctx);
          }

          if (output instanceof Response) {
            return output;
          }
          if (service instanceof AIService && action.id === "models" && new URL(c.req.url).pathname === "/v1/models") {
            const items = (output as { items: Array<{ id: string; modalities: string[] }> }).items;
            return c.json({ object: "list", data: items.filter((item) => item.modalities.includes("stream")).map((item) => ({
              id: item.id, object: "model", created: 0, owned_by: "downcity",
            })) }, 200);
          }
          return c.json(output, 200, service instanceof AIService && action.id.startsWith("keys/") ? no_store_headers() : {});
        } catch (error) {
          ctx.ended_at = new Date();
          ctx.error = error instanceof Error ? error : new Error(String(error));
          // 错误 hook 不能覆盖原始业务或鉴权失败，也不能导致响应漏出内部异常。
          const error_hooks = [service.hook, action.hook, ...global_service_hooks(services)];
          for (const hook of error_hooks) {
            try { await hook.runOnError(ctx); }
            catch { log_http_failure(request_id, 500, "ERROR_HOOK_FAILED"); }
          }
          const response = format_http_error(error, request_id);
          return service instanceof AIService && action.id.startsWith("keys/") ? with_no_store(response) : response;
        }
      };
      register(path, handler);
      // 标准兼容路径复用完全相同的授权、hook、执行与结算处理器。
      if (service instanceof AIService && action.id === "models") register("/v1/models", handler);
      if (service instanceof AIService && action.id === "chat/completions") register("/v1/chat/completions", handler);
    }
  }

  return app;
}

/**
 * 解析并校验当前请求身份。
 *
 * 关键说明（中文）
 * - `trusted_identity` 来自 `Downtown.fetch()` 的进程内 options。
 * - 外部 HTTP 请求仍然只能通过 bearer token 进入 admin/user 身份。
 */
async function authorize_request(
  authenticator: Authenticator,
  trusted_identity: DowntownTrustedIdentity | undefined,
  request: Request,
  auth: Parameters<Authenticator["authorize"]>[1],
) {
  const identity = trusted_identity
    ? authenticator.resolveTrusted(trusted_identity)
    : await authenticator.resolve(request);
  return authenticator.authorize(identity, auth);
}

function trusted_identity_from_env(env: unknown): DowntownTrustedIdentity | undefined {
  return (env as DowntownRouterEnv | undefined)?.trusted_identity;
}

function transport_from_env(env: unknown): DowntownRequestTransport {
  return (env as DowntownRouterEnv | undefined)?.transport ?? "http";
}

/**
 * 收集全局 hook。
 */
function global_service_hooks(services: Service[]): InstallableService["globalHook"][] {
  return services
    .filter((service): service is InstallableService => service instanceof InstallableService)
    .map((service) => service.globalHook);
}

/**
 * 注册 Service 原生 HTTP route。
 */
function register_native_route(
  app: Hono,
  method: ServiceRouteMethod,
  path: string,
  handler: Handler,
): void {
  if (method === "ALL") {
    app.all(path, handler);
    return;
  }
  if (method === "GET") {
    app.get(path, handler);
    return;
  }
  if (method === "POST") {
    app.post(path, handler);
    return;
  }
  app.options(path, handler);
}

/**
 * 同步当前请求 origin。
 *
 * 关键说明（中文）
 * - OAuth callback、better-auth baseURL 依赖当前实际入口域名
 * - 这里按请求 origin 实时覆盖，避免多域名场景下生成旧地址
 */
function sync_request_origin(
  services: Service[],
  origin: string,
): void {
  for (const service of services as Array<Service & { auth?: { options?: { baseURL?: string } } }>) {
    service._baseURL = origin;
    if (service.auth?.options) {
      service.auth.options.baseURL = origin;
    }
  }
}

/**
 * 将 querystring 转成普通对象。
 */
function search_params_to_object(search_params: URLSearchParams): Record<string, unknown> {
  const result: Record<string, string> = {};
  search_params.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/** 认证与 Token 有效性响应禁止被浏览器或中间代理缓存。 */
function no_store_headers(): Record<string, string> {
  return { "cache-control": "no-store", pragma: "no-cache" };
}

/** 为认证端点错误响应补齐禁止缓存语义。 */
function with_no_store(response: Response): Response {
  for (const [key, value] of Object.entries(no_store_headers())) response.headers.set(key, value);
  return response;
}
