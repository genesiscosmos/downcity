/**
 * Service — SDK 核心单元。
 *
 * 每个 Service = 一组 Action + 数据库表 + hook。
 * Action 是 Service 的一等能力单元，可独立被 client 调用。
 * Service 需要的基础设施（DB、Auth、Env）由 City 直接设为属性。
 */

import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import { Hook } from "./hook.js";
import { Action, type ActionFn } from "./action.js";
import type { CityTableApi } from "../store/table-api.js";
import type { Database, DbClient } from "../store/db.js";
import type { RuntimeUser } from "../federation/auth/types.js";
import type { Authenticator } from "../federation/auth/authenticator.js";
import type { EnvProvider } from "../federation/runtime.js";
import type { CityStore } from "./cities/city-store.js";
import type { InstructionActionDefinition, InstructionCapable, InstructionDefinition } from "./instruction.js";
import type { RuntimeMetering } from "../types/Metering.js";
import type { FederationQueue } from "../federation/queue.js";
import type { FederationStorage } from "../federation/storage.js";
import type { FederationRequestTransport } from "../federation/types.js";
import type { BureauTokenStore } from "../federation/auth/bureau-token-store.js";

/**
 * 框架内部初始化入口。
 *
 * 使用模块私有 Symbol，避免 Service 子类覆盖 Federation 掌握的生命周期入口。
 * 业务 Service 只能通过 `on_init()` 扩展自己的初始化逻辑。
 */
const SERVICE_INITIALIZE = Symbol("downcity.service.initialize");

// ===========================================================================
// 鉴权级别
// ===========================================================================

/** 当前请求最终解析出的身份。 */
export type RouteIdentity = "guest" | "user" | "admin";
/** Action 可声明的可访问身份。空数组表示免登录。 */
export type RouteAuth = Array<Exclude<RouteIdentity, "guest">>;

// ===========================================================================
// Context — Action 的唯一上下文
// ===========================================================================

export interface Context {
  /** 请求参数（来自 client 的 input） */
  input: Record<string, unknown>;
  /** 本次请求在 hook / action 之间共享的临时上下文 */
  locals: Record<string, unknown>;
  /** 原始 HTTP Request，服务 webhook 等需要读取 header 时使用 */
  request?: Request;
  /** 原始请求 body 文本，服务 webhook 等需要验签时使用 */
  raw_body?: string;
  /** 当前请求来源 transport。 */
  transport?: FederationRequestTransport;
  /** Action 执行结果（after 阶段可用） */
  output?: unknown;
  /** 当前用户（user_token 解析成功时可用） */
  user?: RuntimeUser;
  /** 当前请求身份 */
  identity?: { kind: RouteIdentity };
  /** 所属 city */
  city?: { city_id: string; status: string };
  /** 当前解析的 variant（如 AI model、翻译语言对等）。由 Service 自行注入 */
  variant?: {
    /** variant 唯一 ID。 */
    id: string;
    /** variant 展示名称。 */
    name: string;
    /** AI 模型对应的真实上游模型 ID。 */
    upstream_model?: string;
    /** AI 模型所属 Channel ID。 */
    channel_id?: string;
    /** variant 可公开扩展信息。 */
    meta?: Record<string, unknown>;
  };
  /** 当前调用的标准化计量信息。由 Service 或 AIChannel 自行注入 */
  metering?: RuntimeMetering;
  /** Action 开始时间（框架自动填充） */
  started_at?: Date;
  /** Action 结束时间（框架自动填充） */
  ended_at?: Date;
  /** 异常对象（onError hook 可用，框架自动填充） */
  error?: Error;
  /** 当前 Service */
  service?: { id: string; name: string };
  /** 当前 Action */
  action?: { id: string };
  /** 数据表（框架注入） */
  db: Record<string, CityTableApi>;
  /** 读环境变量（框架注入） */
  env(key: string): string | undefined;
  /**
   * 延长请求外后台任务生命周期（Worker 等运行时注入）。
   *
   * 关键说明（中文）
   * - 长耗时任务不能阻塞前台 HTTP 请求
   * - 支持 waitUntil 的运行时会继续执行这里传入的 Promise
   */
  waitUntil?(promise: Promise<unknown>): void;
  /** Federation 级异步队列能力（框架注入） */
  queue?: FederationQueue;
  /** Federation 默认存储能力（框架注入） */
  storage?: FederationStorage;
}

// ===========================================================================
// EnvRequirement
// ===========================================================================

export interface EnvRequirement {
  key: string;
  description: string;
  required: boolean;
}

// ===========================================================================
// Action 注册选项
// ===========================================================================

export interface ActionOptions {
  /** HTTP 方法，默认 POST */
  method?: "GET" | "POST";
  /** 允许访问该 action 的身份集合；默认 `["user"]`，传 `[]` 表示免登录 */
  auth?: RouteAuth;
}

/** Service route 支持的 HTTP 方法。 */
export type ServiceRouteMethod = "GET" | "POST" | "OPTIONS" | "ALL";

/**
 * 原生 HTTP route 处理器。
 *
 * 关键说明（中文）
 * - 处理器拿到完整 `Request`，并直接返回 `Response`
 * - 适用于 OAuth callback、第三方 webhook、better-auth 等外部协议入口
 */
export type ServiceNativeRouteHandler = (request: Request) => Promise<Response> | Response;

/**
 * Service 拥有的原生 HTTP route 定义。
 */
export interface ServiceNativeRouteDefinition {
  /** HTTP 方法，`ALL` 表示匹配所有方法。 */
  method: ServiceRouteMethod;
  /** Service namespace 内的路径，例如 `/auth/*`。 */
  path: string;
  /** 允许访问该 route 的身份集合；空数组表示公开。 */
  auth: RouteAuth;
  /** 原生 HTTP route 处理器。 */
  handler: ServiceNativeRouteHandler;
}

/**
 * 归一化 action 鉴权配置。
 *
 * 关键说明（中文）
 * - 默认值仍然是 `["user"]`
 * - `[]` 表示 guest / user / admin 都可访问
 * - 返回值会去重，方便 City 在路由层统一处理
 */
export function normalizeRouteAuth(auth?: RouteAuth): RouteAuth {
  if (auth === undefined) return ["user"];
  return [...new Set(auth)];
}

// ===========================================================================
// Service
// ===========================================================================

export class Service {
  readonly id: string;
  readonly name: string;
  /** Service 级 hook，该 Service 下所有 Action 共享 */
  readonly hook = new Hook();
  readonly tables?: Record<string, AnySQLiteTable | AnyPgTable>;
  readonly env?: EnvRequirement[];
  /** 当前模块可选的说明文档。 */
  instruction?: InstructionDefinition;

  /** Action 注册表 */
  private actionMap = new Map<string, { action: Action; method: "GET" | "POST"; auth: RouteAuth }>();
  /** 原生 HTTP route 注册表 */
  private nativeRouteMap = new Map<string, ServiceNativeRouteDefinition>();

  // ========== City 注入 ==========

  _db?: Database;
  _client?: { $client: DbClient };
  _authenticator?: Authenticator;
  _env?: EnvProvider;
  _cityStore?: CityStore;
  /** Federation Bureau Token 持久化与校验入口。 */
  _bureauTokenStore?: BureauTokenStore;

  /** 原始数据库实例（better-sqlite3 / D1 等） */
  _raw?: unknown;

  /** 服务公网 URL */
  _baseURL?: string;

  /** Federation 级异步队列能力 */
  _queue?: FederationQueue;

  /** Federation 默认存储能力 */
  _storage?: FederationStorage;

  constructor(options: {
    id: string;
    name?: string;
    tables?: Record<string, AnySQLiteTable | AnyPgTable>;
    env?: EnvRequirement[];
  }) {
    this.id = options.id;
    this.name = options.name ?? options.id;
    this.tables = options.tables;
    this.env = options.env;
  }

  // ========== 生命周期 ==========

  /**
   * 执行框架内部初始化流程。
   *
   * 该入口由 `initialize_service()` 通过模块私有 Symbol 调用，子类无法覆盖。
   */
  async [SERVICE_INITIALIZE](): Promise<void> {
    await this.on_init();
  }

  /**
   * Service 自定义初始化扩展点。
   *
   * 子类只应覆盖该方法处理自身状态，框架级安装流程由 Federation 独立保证。
   */
  protected async on_init(): Promise<void> {}

  // ========== Action 注册 ==========

  /**
   * 注册一个 Action（默认 POST，auth=["user"]）。
   */
  action(id: string, fn: ActionFn, opts?: ActionOptions): Action {
    if (this.actionMap.has(id)) {
      throw new Error(`Duplicate action: ${this.id}.${id}`);
    }
    const action = new Action(id, fn);
    this.actionMap.set(id, {
      action,
      method: opts?.method ?? "POST",
      auth: normalizeRouteAuth(opts?.auth),
    });
    return action;
  }

  /** 获取已注册的 Action */
  get(id: string): Action | undefined {
    return this.actionMap.get(id)?.action;
  }

  /** 列出所有已注册的 Action */
  list(): Action[] {
    return [...this.actionMap.values()].map((e) => e.action);
  }

  /** 列出 Action 及其元数据（Federation 内部使用） */
  _listActionDefs(): Array<{ action: Action; method: "GET" | "POST"; auth: RouteAuth }> {
    return [...this.actionMap.values()];
  }

  /**
   * 注册原生 HTTP route（Federation 内部使用）。
   */
  _registerNativeRoute(definition: {
    method: ServiceRouteMethod;
    path: string;
    auth?: RouteAuth;
    handler: ServiceNativeRouteHandler;
  }): void {
    const path = normalizeNativeRoutePath(definition.path);
    const method = definition.method;
    const key = `${method} ${path}`;
    if (this.nativeRouteMap.has(key)) {
      throw new Error(`Duplicate native route: ${this.id}.${method} ${path}`);
    }
    this.nativeRouteMap.set(key, {
      method,
      path,
      auth: normalizeRouteAuth(definition.auth),
      handler: definition.handler,
    });
  }

  /** 列出原生 HTTP route 及其元数据（Federation 内部使用）。 */
  _listNativeRouteDefs(): ServiceNativeRouteDefinition[] {
    return [...this.nativeRouteMap.values()];
  }

  /**
   * 返回 instruction 聚合时使用的动作定义。
   */
  _listInstructionActions(): InstructionActionDefinition[] {
    return this._listActionDefs().map((item) => ({
      id: item.action.id,
      method: item.method,
      auth: item.auth,
    }));
  }
}

/**
 * 执行 Service 自定义初始化。
 *
 * 该函数仅供 Federation 内部生命周期编排使用，不从 package 公共入口导出。
 */
export async function initialize_service(service: Service): Promise<void> {
  await service[SERVICE_INITIALIZE]();
}

export type InstructionService = Service & InstructionCapable;

/**
 * 归一化 Service namespace 内的原生 route 路径。
 */
function normalizeNativeRoutePath(path: string): string {
  const normalized = `/${path.replace(/^\/+/, "")}`;
  return normalized === "/" ? "" : normalized;
}
