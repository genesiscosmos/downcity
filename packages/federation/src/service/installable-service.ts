/**
 * 可安装服务桥接模块。
 *
 * 提供 `InstallableService` 基类，把带 `install(ctx)` 生命周期的服务
 * 统一桥接到 Downcity action route 与原生 HTTP route 体系。
 */

import type { UserSessionCredentials } from "../types/UserSession.js";
import { Service, type Context, type EnvRequirement, type ServiceNativeRouteHandler, type ServiceRouteMethod } from "./service.js";
import type { Action } from "./action.js";
import { Hook } from "./hook.js";
import { parse_action_input } from "../federation/http/request-input.js";
import type { CityTableApi } from "../store/table-api.js";
import type { Database } from "../database/Database.js";
import type { ServiceDatabaseContext } from "../types/database/Database.js";
import type { CreateUserTokenInput, UserTokenIssueResult, RuntimeUser } from "../federation/auth/types.js";
import type { InstructionDefinition } from "./instruction.js";
import type { FederationRequestTransport } from "../federation/types.js";
import type {
} from "../federation/auth/types.js";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import type { FederationQueue } from "../federation/queue.js";
import type { ApiDocumentation, ServiceDiscoveryOptions } from "../types/ServiceDiscovery.js";

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
  /** 登录交换后创建可续期的设备会话，proof 必须来自私密登录交换证明。 */
  create_user_session(user_token: string, proof: string): Promise<UserSessionCredentials>;
  /** 轮换刷新凭证，相同 refresh_id 支持有界重试。 */
  refresh_user_session(refresh_token: string, refresh_id: string): Promise<UserSessionCredentials>;
  /** 使用刷新凭证撤销整条设备会话，访问凭证过期不影响退出。 */
  revoke_user_session(refresh_token: string): Promise<void>;
  /** 当前 Service 可使用的受限数据库能力。 */
  readonly database: ServiceDatabaseContext;

  table<TRow extends Record<string, unknown> = Record<string, unknown>>(name: string): CityTableApi<TRow>;

  route(config: ServiceActionRouteConfig): Action;
  route(config: ServiceNativeRouteConfig): void;

  hook: {
    before(fn: (ctx: Context) => Promise<void> | void): void;
    after(fn: (ctx: Context) => Promise<void> | void): void;
    onError(fn: (ctx: Context) => Promise<void> | void): void;
  };

  createUserToken(input: CreateUserTokenInput): Promise<UserTokenIssueResult>;
  /** 验证原始 User Token 后持久化撤销其 jti；重复撤销幂等，失败时抛错。 */
  revoke_user_token(token: string): Promise<void>;
  /**
   * 在同一数据库事务中执行多表领域命令。
   *
   * handler 在乐观并发冲突时可能重跑，因此只能包含可重试的数据库领域逻辑，
   * 外部网络请求等不可回滚副作用必须在事务成功后执行。
   */
  transaction<TResult>(
    handler: (context: ServiceTransactionContext) => Promise<TResult>,
  ): Promise<TResult>;
  env(key: string): string | undefined;
}

/** 绑定单一数据库事务的 Service Context。 */
export interface ServiceTransactionContext {
  /** 读取绑定当前事务连接的数据表。 */
  table<TRow extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
  ): CityTableApi<TRow>;
}

/** 单一方言下的 Service 数据库声明。 */
export interface ServiceDatabaseSchema {
  /** 当前方言使用的 Drizzle 表。 */
  tables: Record<string, AnySQLiteTable | AnyPgTable>;
  /** 在通用建表前执行的幂等 DDL。 */
  ddl?: string[];
}

/** Service 按 Federation 方言提供数据库声明。 */
export type ServiceDatabaseSchemas = Record<string, ServiceDatabaseSchema | undefined>;

/** 进入 Action 与 hook 管线的 HTTP 路由配置。 */
export interface ServiceActionRouteConfig {
  /** 由发现接口和 OpenAPI 共用的注册文档。 */
  documentation?: ApiDocumentation;
  /** 路由接受的 HTTP 方法；POST 按 body 声明解析请求体。 */
  method: "GET" | "POST";
  /** Service namespace 内的 Action 路径，注册时移除前导斜杠。 */
  path: string;
  /**
   * HTTP 请求体解析模式，默认 `json`。
   * `json` 只接受 JSON 对象，空体为 `{}`，无效 JSON 或非对象输入返回 400；
   * `raw` 保留原文供 text() 读取与 webhook 验签，json() 调用时才严格解析。
   */
  body?: "json" | "raw";
  /** 允许访问的身份集合；默认要求 user，空数组表示公开访问。 */
  auth?: Array<"user" | "admin">;
  /**
   * 是否公开访问。
   *
   * 关键说明（中文）
   * - `true` 等价于 `auth: []`
   * - 仅影响 Downcity Action 路由的鉴权要求
   */
  public?: boolean;
  /** 接收桥接后的 Action 请求上下文并生成 HTTP 响应的业务处理器。 */
  handler: (ctx: ServiceRouteContext) => Promise<Response> | Response;
}

export interface ServiceNativeRouteConfig {
  /** 由发现接口和 OpenAPI 共用的注册文档。 */
  documentation?: ApiDocumentation;
  /** 原生路由接受的方法。 */
  method: ServiceRouteMethod;
  /** 服务 namespace 内的路径。 */
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
  /** 可选 City 来源，仅作归因，不授予访问权限。 */
  city_id?: string;
  /** 本次 HTTP 请求的服务端关联 ID；非 HTTP 调用时可能未提供。 */
  request_id?: string;
  /** 当前 user_token 解析出的用户；免登录或 admin 请求时可能为空 */
  user?: RuntimeUser;
  /** 原始 HTTP 请求 */
  request: Request;
  /** 合并 HTTP 处理截止时间与客户端取消的信号；业务上游请求应继续传递此信号。 */
  abort_signal?: AbortSignal;
  /** 当前请求来源 transport。 */
  transport?: FederationRequestTransport;
  /** Worker 等运行时用于延长后台 Promise 生命周期的能力。 */
  waitUntil?(promise: Promise<unknown>): void;
  /** Federation 级异步 Action Queue。 */
  queue?: FederationQueue;
  /** 读取 JSON 对象；raw 模式按需严格解析原文，空体为 `{}`，无效 JSON 或非对象输入抛出 400。 */
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

  constructor(env?: EnvRequirement[], discovery?: ServiceDiscoveryOptions) {
    super({ id: "service", env, ...discovery });
  }

  abstract install(ctx: ServiceInstallContext): void;

  /**
   * 安装 Service 的 Schema 映射、Action Route、Native Route 与全局 Hook。
   *
   * 该入口由 `install_service()` 通过模块私有 Symbol 调用，业务子类只能实现
   * `install(ctx)`，不能跳过框架安装流程。
   */
  [INSTALL_SERVICE](database: Database): void {
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
          documentation: config.documentation,
        });
        return;
      }

      // 去掉前导 /，与 client ServiceClient.action() 的 normalizeName 对齐
      const action_id = config.path.replace(/^\/+/, "");
      return self.action(action_id, async (svc_ctx: Context) => {
        const request = svc_ctx.request ?? new Request("http://local");
        return await config.handler({
          request_id: svc_ctx.request_id,
          city_id: svc_ctx.city_id,
          user: svc_ctx.user,
          request,
          abort_signal: svc_ctx.abort_signal ?? request.signal,
          transport: svc_ctx.transport,
          waitUntil: svc_ctx.waitUntil,
          queue: svc_ctx.queue,
          json: async <T extends Record<string, unknown> = Record<string, unknown>>() => (
            config.body === "raw" ? parse_action_input(svc_ctx.raw_body ?? "") : svc_ctx.input
          ) as T,
          text: async () => svc_ctx.raw_body ?? (config.body === "raw" ? "" : JSON.stringify(svc_ctx.input)),
          jsonResponse: (body, status) => new Response(JSON.stringify(body), {
            status, headers: { "content-type": "application/json" },
          }),
        });
      }, { method: config.method, body: config.body, auth: resolve_route_auth(config), documentation: config.documentation });
    }

    const ctx: ServiceInstallContext = {
      create_user_session: (token, proof) => self._authenticator!.user_sessions.create(token, proof),
      refresh_user_session: (token, id) => self._authenticator!.user_sessions.refresh(token, id),
      revoke_user_session: (token) => self._authenticator!.user_sessions.revoke(token),
      database: database.service_context(),

      table<TRow extends Record<string, unknown> = Record<string, unknown>>(name: string): CityTableApi<TRow> {
        const table = self.tables?.[name];
        if (!table) throw new Error(`Unknown table: ${name}`);
        return database.table<TRow>(table);
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

      async revoke_user_token(token) {
        if (!self._authenticator) throw new Error("Authenticator not ready");
        await self._authenticator.revoke_user_token(token);
      },


      async transaction(handler) {
        return await database.transaction(async (transaction) => handler({
            table<TRow extends Record<string, unknown> = Record<string, unknown>>(
              name: string,
            ): CityTableApi<TRow> {
              const table = self.tables?.[name];
              if (!table) throw new Error(`Unknown table: ${name}`);
              return transaction.table<TRow>(table);
            },
          }));
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
export function install_service(service: InstallableService, database: Database): void {
  service[INSTALL_SERVICE](database);
}

export type ServiceDefinition = ServiceDiscoveryOptions & {
  /** 服务唯一标识。 */
  id: string;
  /** 服务展示名。 */
  name?: string;
  /** 服务版本声明。 */
  version?: string;
  /** 服务拥有的数据表。 */
  schema?: Record<string, unknown>;
  /** 各数据库方言的表和 DDL。 */
  database_schemas?: ServiceDatabaseSchemas;
  /**
   * 服务依赖的运行时环境变量声明。
   *
   * 关键说明（中文）
   * - 这些 key 会出现在 `/v1/services` 中，供 manager / admin UI 展示
   * - City 会把这些 key 自动注册到自己的 env requirement 目录中
   */
  env?: EnvRequirement[];
  /** 公开的完整服务说明。 */
  instruction?: InstructionDefinition;
  /** 注册服务路由和 hook。 */
  install(ctx: ServiceInstallContext): void;
};

export function asInstallableService(bp: ServiceDefinition): InstallableService {
  return new (class extends InstallableService {
    constructor() {
      super(bp.env, bp);
      (this as any).id = bp.id;
      if (bp.name) (this as any).name = bp.name;
      if (bp.schema) (this as any).tables = bp.schema;
      if (bp.database_schemas) (this as any).database_schemas = bp.database_schemas;
      if (bp.instruction) this.instruction = bp.instruction;
    }
    install(ctx: ServiceInstallContext): void {
      bp.install(ctx);
    }
  })();
}
