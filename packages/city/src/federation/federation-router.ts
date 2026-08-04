/**
 * Federation 路由构建模块。
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
import type { Runtime } from "./runtime.js";
import type { RuntimeUser } from "./auth/types.js";
import { build_federation_instruction } from "./federation-instruction.js";
import { collect_federation_env_catalog } from "./federation-env-catalog.js";
import type { FederationRequestTransport, FederationTrustedIdentity } from "./types.js";
import type { BureauRecord, RuntimeBureauToken } from "../types/Bureau.js";

declare module "hono" {
  interface ContextVariableMap {
    identity?: { kind: "guest" | "user" | "bureau" | "admin" };
    user?: RuntimeUser;
    bureau?: BureauRecord;
    bureau_token?: RuntimeBureauToken;
  }
}

/**
 * Federation router 在单次请求里接收的进程内变量。
 */
interface FederationRouterEnv {
  /** 由 `Federation.fetch()` 传入的进程内可信身份。 */
  trusted_identity?: FederationTrustedIdentity;
  /** 当前请求来源 transport。 */
  transport?: FederationRequestTransport;
}

/**
 * 构建 Federation 对外路由。
 */
export function build_federation_router(params: {
  /** runtime 能力 */
  runtime: Runtime;
  /** 已注册服务 */
  services: Service[];
  /** 鉴权器 */
  authenticator: Authenticator;
  /** 表映射 */
  table_map: Map<string, CityTableApi>;
}): Hono {
  const { runtime, services, authenticator, table_map } = params;
  const app = new Hono();

  app.get("/health", (c) => c.json({
    ok: true,
    name: "downcity",
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
      return build_error_response(error);
    }
  });

  app.use("/v1/*", async (c, next) => {
    // 关键说明（中文）
    // Federation env 默认读取运行时内存 cache。
    // 管理端通过 /v1/env/upsert、/remove、/import 修改 env 时会自动更新当前 cache；
    // 如果直接改数据库，可通过 /v1/env/refresh 或 city CLI 手动刷新。
    sync_request_origin(services, new URL(c.req.raw.url).origin);
    await next();
  });

  app.get("/v1/services", (c) =>
    c.json({
      items: services.map((service) => ({
        id: service.id,
        name: service.name,
        env: service.env ?? [],
      })),
    }),
  );

  app.get("/v1/env/catalog", async (c) => {
    try {
      await authorize_request(authenticator, trusted_identity_from_env(c.env), c.req.raw, ["admin"]);

      return c.json({ items: collect_federation_env_catalog(services, runtime.env) });
    } catch (error) {
      return build_error_response(error);
    }
  });

  app.get("/v1/federation/instruction", async (c) => {
    try {
      await authorize_request(authenticator, trusted_identity_from_env(c.env), c.req.raw, ["admin"]);

      return new Response(await build_federation_instruction(services), {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    } catch (error) {
      return build_error_response(error);
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
          return await def.handler(c.req.raw);
        } catch (error) {
          return build_error_response(error);
        }
      });
    }
  }

  for (const service of services) {
    for (const def of service._listActionDefs()) {
      const action = def.action;
      const path = `/v1/${encodeURIComponent(service.id)}/${action.id}`;
      const register = def.method === "GET" ? app.get.bind(app) : app.post.bind(app);

      register(path, async (c) => {
        let raw_body: string | undefined;
        const input = def.method === "GET"
          ? search_params_to_object(new URL(c.req.raw.url).searchParams)
          : parse_request_input(raw_body = await c.req.text().catch(() => ""));

        const db: Record<string, CityTableApi> = {};
        if (service.tables) {
          for (const name of Object.keys(service.tables)) {
            db[name] = table_map.get(`${service.id}.${name}`)!;
          }
        }

        const ctx: Context = {
          input,
          locals: {},
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

        try {
          const identity = await authorize_request(authenticator, trusted_identity_from_env(c.env), c.req.raw, def.auth);
          ctx.identity = { kind: identity.level };
          ctx.user = identity.user;
          ctx.bureau = identity.bureau;
          ctx.bureau_token = identity.bureau_token;

          for (const hook of global_service_hooks(services)) {
            await hook.runBefore(ctx);
          }
          await action.hook.runBefore(ctx);
          await service.hook.runBefore(ctx);

          const output = await action.run(ctx);
          ctx.output = output;
          ctx.ended_at = new Date();

          await service.hook.runAfter(ctx);
          await action.hook.runAfter(ctx);
          for (const hook of global_service_hooks(services)) {
            await hook.runAfter(ctx);
          }

          if (output instanceof Response) return output;
          return c.json(output, 200);
        } catch (error) {
          ctx.ended_at = new Date();
          ctx.error = error instanceof Error ? error : new Error(String(error));
          await service.hook.runOnError(ctx);
          await action.hook.runOnError(ctx);
          for (const hook of global_service_hooks(services)) {
            await hook.runOnError(ctx);
          }
          return build_error_response(error);
        }
      });
    }
  }

  return app;
}

/**
 * 解析并校验当前请求身份。
 *
 * 关键说明（中文）
 * - `trusted_identity` 来自 `Federation.fetch()` 的进程内 options。
 * - 外部 HTTP 请求仍然只能通过 bearer token 进入 admin/bureau/user 身份。
 */
async function authorize_request(
  authenticator: Authenticator,
  trusted_identity: FederationTrustedIdentity | undefined,
  request: Request,
  auth: Parameters<Authenticator["authorize"]>[1],
) {
  const identity = trusted_identity
    ? authenticator.resolveTrusted(trusted_identity)
    : await authenticator.resolve(request);
  return authenticator.authorize(identity, auth);
}

function trusted_identity_from_env(env: unknown): FederationTrustedIdentity | undefined {
  return (env as FederationRouterEnv | undefined)?.trusted_identity;
}

function transport_from_env(env: unknown): FederationRequestTransport {
  return (env as FederationRouterEnv | undefined)?.transport ?? "http";
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
 * 解析 POST 请求体。
 */
function parse_request_input(raw_body: string): Record<string, unknown> {
  if (!raw_body) return {};
  try {
    const parsed = JSON.parse(raw_body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
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

/**
 * 统一错误响应。
 */
function build_error_response(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as { statusCode?: number }).statusCode ?? 500;
  const code = (error as { code?: string }).code;
  return Response.json({ error: {
    ...(code ? { code } : {}),
    message,
    type: "server_error",
  } }, { status: status as number });
}
