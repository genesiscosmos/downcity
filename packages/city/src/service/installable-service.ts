/**
 * 可安装服务桥接模块。
 *
 * 提供 `InstallableService` 基类，把带 `install(ctx)` 生命周期的服务
 * 统一桥接到 Downcity action route 与原生 HTTP route 体系。
 */

import { Service, type Context, type EnvRequirement, type ServiceNativeRouteHandler, type ServiceRouteMethod } from "./service.js";
import type { Action } from "./action.js";
import { Hook } from "./hook.js";
import { TableApi } from "../store/table-api.js";
import type { CityTableApi } from "../store/table-api.js";
import type { CreateUserTokenInput, UserTokenIssueResult, RuntimeUser } from "../federation/auth/types.js";
import type { InstructionDefinition } from "./instruction.js";
import type { FederationRequestTransport } from "../federation/types.js";

/**
 * 框架内部安装入口。
 *
 * 使用模块私有 Symbol，保证 InstallableService 子类无法覆盖路由安装流程。
 */
const INSTALL_SERVICE = Symbol("downcity.service.install");

// ===========================================================================
// ServiceInstallContext
// ===========================================================================

export interface ServiceInstallContext {
  table<TRow extends Record<string, unknown> = Record<string, unknown>>(name: string): CityTableApi<TRow>;

  route(config: ServiceActionRouteConfig): Action;
  route(config: ServiceNativeRouteConfig): void;

  hook: {
    before(fn: (ctx: Context) => Promise<void> | void): void;
    after(fn: (ctx: Context) => Promise<void> | void): void;
    onError(fn: (ctx: Context) => Promise<void> | void): void;
  };

  createUserToken(input: CreateUserTokenInput): Promise<UserTokenIssueResult>;
  env(key: string): string | undefined;
}

export interface ServiceActionRouteConfig {
  method: "GET" | "POST";
  path: string;
  auth?: Array<"user" | "admin">;
  /**
   * 是否公开访问。
   *
   * 关键说明（中文）
   * - `true` 等价于 `auth: []`
   * - 仅影响 Downcity Action 路由的鉴权要求
   */
  public?: boolean;
  handler: (ctx: ServiceRouteContext) => Promise<Response> | Response;
}

export interface ServiceNativeRouteConfig {
  method: ServiceRouteMethod;
  path: string;
  /**
   * 是否公开访问。
   *
   * 关键说明（中文）
   * - `true` 等价于 `auth: []`
   * - native HTTP route 不进入 action/hook 管线，但仍可声明 route 级鉴权
   */
  public?: boolean;
  auth?: Array<"user" | "admin">;
  handler: {
    /**
     * 原生 HTTP 请求处理器。
     *
     * 适用于 OAuth callback、第三方 webhook、better-auth 等需要完整
     * `Request` / `Response` 语义的协议入口。
     */
    request: ServiceNativeRouteHandler;
  };
}

export interface ServiceRouteContext {
  /** 当前 user_token 解析出的用户；免登录或 admin 请求时可能为空 */
  user?: RuntimeUser;
  /** 当前 user_token 对应的 city；免登录或 admin 请求时可能为空 */
  city?: { city_id: string; status: string };
  /** 原始 HTTP 请求 */
  request: Request;
  /** 当前请求来源 transport。 */
  transport?: FederationRequestTransport;
  /** 读取已解析 JSON 请求体 */
  json<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<T>;
  /** 读取原始文本请求体 */
  text(): Promise<string>;
  /** 快速返回 JSON Response */
  jsonResponse(body: unknown, status?: number): Response;
}

function is_native_route_config(
  config: ServiceActionRouteConfig | ServiceNativeRouteConfig,
): config is ServiceNativeRouteConfig {
  return typeof config.handler === "object" && config.handler !== null && "request" in config.handler;
}

function resolve_route_auth(
  config: { auth?: Array<"user" | "admin">; public?: boolean },
): Array<"user" | "admin"> | undefined {
  if (config.public === true) return [];
  return config.auth;
}

// ===========================================================================
// InstallableService 基类
// ===========================================================================

export abstract class InstallableService extends Service {
  readonly schema?: Record<string, any>;
  /**
   * 服务级全局 hook。
   *
   * 通过 ServiceInstallContext.hook 注册，City 会在所有 Service Action
   * 执行时统一触发。服务自己的路由仍然通过 Service.action() 暴露。
   */
  readonly globalHook = new Hook();

  constructor(env?: EnvRequirement[]) {
    super({ id: "service", env });
  }

  abstract install(ctx: ServiceInstallContext): void;

  /**
   * 安装 Service 的 Schema 映射、Action Route、Native Route 与全局 Hook。
   *
   * 该入口由 `install_service()` 通过模块私有 Symbol 调用，业务子类只能实现
   * `install(ctx)`，不能跳过框架安装流程。
   */
  [INSTALL_SERVICE](): void {
    if (this.schema && !this.tables) {
      (this as any).tables = this.schema;
    }

    const self = this;
    function route(config: ServiceActionRouteConfig): Action;
    function route(config: ServiceNativeRouteConfig): void;
    function route(config: ServiceActionRouteConfig | ServiceNativeRouteConfig): Action | void {
      if (is_native_route_config(config)) {
        self._registerNativeRoute({
          method: config.method,
          path: config.path,
          auth: resolve_route_auth(config),
          handler: config.handler.request,
        });
        return;
      }

      // 去掉前导 /，与 client ServiceClient.action() 的 normalizeName 对齐
      const actionId = config.path.replace(/^\/+/, "");
      return self.action(actionId, async (svcCtx: Context) => {
        return await config.handler({
          user: svcCtx.user,
          city: svcCtx.city,
          request: svcCtx.request ?? new Request("http://local"),
          transport: svcCtx.transport,
          json: async <T extends Record<string, unknown> = Record<string, unknown>>() => svcCtx.input as T,
          text: async () => svcCtx.raw_body ?? JSON.stringify(svcCtx.input),
          jsonResponse: (body, status) => new Response(JSON.stringify(body), {
            status, headers: { "content-type": "application/json" },
          }),
        });
      }, { method: config.method as "GET" | "POST", auth: resolve_route_auth(config) });
    }

    const ctx: ServiceInstallContext = {
      table<TRow extends Record<string, unknown> = Record<string, unknown>>(name: string): CityTableApi<TRow> {
        if (!self._db) throw new Error("InstallableService database is not ready");
        const table = self.tables?.[name];
        if (!table) throw new Error(`Unknown table: ${name}`);
        return new TableApi(self._db, table) as unknown as CityTableApi<TRow>;
      },

      route,

      hook: {
        before(fn) { self.globalHook.before(fn); },
        after(fn) { self.globalHook.after(fn); },
        onError(fn) { self.globalHook.onError(fn); },
      },

      async createUserToken(input) {
        if (!self._authenticator) throw new Error("Authenticator not ready");
        return self._authenticator.createToken(input);
      },

      env(key) {
        return self._env?.get(key);
      },
    };

    this.install(ctx);
  }
}

/**
 * 执行 InstallableService 框架安装流程。
 *
 * 该函数仅供 Federation 内部生命周期编排使用，不从 package 公共入口导出。
 */
export function install_service(service: InstallableService): void {
  service[INSTALL_SERVICE]();
}

export type ServiceDefinition = {
  id: string;
  name?: string;
  version?: string;
  schema?: Record<string, unknown>;
  /**
   * 服务依赖的运行时环境变量声明。
   *
   * 关键说明（中文）
   * - 这些 key 会出现在 `/v1/services` 中，供 manager / admin UI 展示
   * - City 会把这些 key 自动注册到自己的 env requirement 目录中
   */
  env?: EnvRequirement[];
  instruction?: InstructionDefinition;
  install(ctx: ServiceInstallContext): void;
};

export function asInstallableService(bp: ServiceDefinition): InstallableService {
  return new (class extends InstallableService {
    constructor() {
      super(bp.env);
      (this as any).id = bp.id;
      if (bp.name) (this as any).name = bp.name;
      if (bp.schema) (this as any).tables = bp.schema;
      if (bp.instruction) this.instruction = bp.instruction;
    }
    install(ctx: ServiceInstallContext): void {
      bp.install(ctx);
    }
  })();
}
