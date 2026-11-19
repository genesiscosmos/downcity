/**
 * Federation 包内服务运行时。
 *
 * 本模块由统一 Federation 入口持有，负责业务服务的执行资源：
 * - service 注册
 * - runtime 初始化
 * - 鉴权器访问
 * - HTTP 路由暴露
 *
 * 具体初始化、路由构建、instruction 聚合等实现已拆到独立模块。
 */

import { track_response } from "../access/response-lifetime.js";
import type { Hono, ExecutionContext as HonoExecutionContext } from "hono";
import { Service, maintain_service } from "../service/service.js";
import { UserTokenRevocationStore } from "./auth/user-token-revocation-store.js";
import { measure_startup } from "./startup-timing.js";
import { asInstallableService, type ServiceDefinition } from "../service/installable-service.js";
import { EnvService } from "../service/env/env-service.js";
import { build_federation_instruction } from "./federation-instruction.js";
import { list_service_catalog, get_service_catalog_detail } from "./service-catalog.js";
import { build_service_openapi } from "./service-openapi.js";
import { initialize_federation, prepare_federation_schema } from "./federation-init.js";
import { build_federation_router } from "./federation-router.js";
import { create_federation_runtime } from "./federation-runtime.js";
import { FederationQueue } from "./queue.js";
import { run_federation_middlewares } from "./federation-middleware.js";
import { execute_federation_http } from "./http/http-execution.js";
import { resolve_http_policy, type ResolvedFederationHttpPolicy } from "./http/http-policy.js";
import type { FederationRuntimeOptions, FederationHealthStatus, FederationFetchOptions } from "./types.js";
import type { FederationStorage } from "./storage.js";
import type { Authenticator } from "./auth/authenticator.js";
import type { Runtime } from "./runtime.js";
import type { CityTableApi } from "../store/table-api.js";
import type { FederationMiddleware, FederationMiddlewareContext } from "../types/FederationMiddleware.js";

export class FederationRuntime {
  private readonly runtime: Runtime;
  private readonly options: FederationRuntimeOptions;
  /** 构造期校验并补齐的服务端 HTTP 策略。 */
  private readonly http_policy: ResolvedFederationHttpPolicy;
  readonly queue: FederationQueue;
  private readonly services = new Map<string, Service>();
  private readonly middlewares: FederationMiddleware[] = [];

  private table_map?: Map<string, CityTableApi>;
  private init_promise?: Promise<void>;
  private hono?: Hono;
  private authenticator?: Authenticator;
  /** 活跃前台请求与流；关闭时统一撤销。 */
  private readonly requests = new Set<AbortController>();
  /** 已进入的前台业务、队列与维护执行；取消响应不代表业务已经停止。 */
  private readonly executions = new Set<Promise<unknown>>();
  private disposed = false;
  private execution_guard?: () => () => void;

  /** owner 注入的同一门禁覆盖后台队列和维护，不能只封闭 HTTP facade。 */
  guard_execution(acquire: (() => () => void) | undefined): void { this.execution_guard = acquire; }
  private dispose_promise?: Promise<void>;

  constructor(options: FederationRuntimeOptions) {
    this.options = options;
    this.http_policy = resolve_http_policy(options.http);
    this.runtime = create_federation_runtime(options);
    this.queue = new FederationQueue({
      ensure_ready: () => this.ready(),
      execute: (handler) => this.run_execution(handler),
      get_services: () => this.get_services(),
      get_table_map: () => {
        if (!this.table_map) throw new Error("Federation init has not completed yet");
        return this.table_map;
      },
      get_env: () => this.runtime.env,
      get_queue: () => this.queue,
      get_storage: () => this.runtime.storage,
    });
  }

  /**
   * 注册 Federation 默认存储后端。
   */
  storage(storage: FederationStorage): this {
    this.assert_configuring();
    this.runtime.storage = storage;
    return this;
  }

  /**
   * 注册 service。
   */
  use(service_input: Service | ServiceDefinition): this {
    this.assert_configuring();
    const service = "install" in service_input && !("get" in service_input)
      ? asInstallableService(service_input)
      : service_input;
    if (this.services.has((service as Service).id)) throw new Error(`Duplicate Federation service: ${(service as Service).id}`);
    this.services.set((service as Service).id, service as Service);
    return this;
  }

  /**
   * 注册 Federation HTTP middleware。
   *
   * 关键说明（中文）
   * - middleware 在内部 Hono router 之前执行。
   * - 适合 CORS、body limit、rate limit、request id、timeout 等 HTTP 横切能力。
   * - 不用于依赖 `ctx.user` 的业务生命周期逻辑。
   */
  middle(...middlewares: FederationMiddleware[]): this {
    this.assert_configuring();
    this.middlewares.push(...middlewares);
    return this;
  }

  /**
   * 获取单个 service。
   */
  get_service(id: string): Service | undefined {
    return this.services.get(id);
  }

  /**
   * 获取所有已注册 service。
   */
  get_services(): Service[] {
    return [...this.services.values()];
  }

  /** 读取当前实例服务目录，执行有界的本地条件检查。 */
  async list_services(): Promise<import("../types/ServiceCatalog.js").ServiceCatalogSummary[]> {
    await this.ready();
    return list_service_catalog(this.get_services());
  }

  /** 获取服务详细文档，未注册服务返回 undefined。 */
  async describe_service(service_id: string): Promise<import("../types/ServiceCatalog.js").ServiceCatalogDetail | undefined> {
    await this.ready();
    return get_service_catalog_detail(this.get_services(), service_id);
  }

  /** 从当前注册表生成 OpenAPI，不执行任何业务调用。 */
  async openapi(): Promise<import("../types/ServiceDiscovery.js").ApiSchema> {
    await this.ready();
    return build_service_openapi(this.get_services());
  }

  /**
   * 获取鉴权器。
   */
  async get_authenticator(): Promise<Authenticator> {
    await this.ready();
    return this.authenticator!;
  }

  /**
   * 获取表 API。
   */
  async table<TRow extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
  ): Promise<CityTableApi<TRow>> {
    await this.ready();
    const api = this.table_map?.get(name);
    if (!api) throw new Error(`Unknown schema table: ${name}`);
    return api as CityTableApi<TRow>;
  }

  /**
   * 处理 HTTP 请求。
   */
  readonly fetch = async (request: Request, options: FederationFetchOptions = {}): Promise<Response> => {
    if (this.disposed) throw new Error("federation_disposed");
    const controller = new AbortController();
    const tracked_request = new Request(request, { signal: controller.signal });
    const abort = () => controller.abort(request.signal.reason);
    if (request.signal.aborted) abort();
    else request.signal.addEventListener("abort", abort, { once: true });
    this.requests.add(controller);
    const response = await execute_federation_http(tracked_request, this.http_policy, async (prepared_request, request_id) => {
      // 初始化也受前台执行期限约束；共享初始化不会因单个客户端取消而被撤销。
      await this.ready();
      if (prepared_request.signal.aborted) throw prepared_request.signal.reason;
      const ctx: FederationMiddlewareContext = {
        request: prepared_request,
        request_id,
        abort_signal: prepared_request.signal,
        execution: options.execution,
        runtime: this.runtime,
        federation: { services: () => this.get_services() },
        locals: { request_id },
      };
      return this.run_execution(() => run_federation_middlewares(this.middlewares, ctx, () => {
        if (ctx.abort_signal.aborted) throw ctx.abort_signal.reason;
        return Promise.resolve(this.hono!.fetch(
          ctx.request,
          { trusted_identity: options.trusted_identity, transport: options.transport,
            federation_request_id: request_id, abort_signal: ctx.abort_signal },
          options.execution as HonoExecutionContext | undefined,
        ));
      }));
    });
    const finish = () => {
      this.requests.delete(controller);
      request.signal.removeEventListener("abort", abort);
    };
    return track_response(response, controller.signal, finish);
  };

  /**
   * 健康检查。
   *
   * 说明（中文）
   * - 同时报告异步调度能力是否可用，使部署期就能发现「有异步任务但没有队列」，
   *   而不必等到第一次任务入队失败。
   */
  async health(): Promise<FederationHealthStatus> {
    await this.ready();
    const services = this.get_services();
    return {
      ok: true,
      name: "downcity",
      checked_at: new Date().toISOString(),
      services: services.map((service) => service.id),
      service_list: services.map((service) => ({ id: service.id, name: service.name })),
      queue: this.queue.is_available(),
    };
  }

  /**
   * 聚合 instruction 文档。
   */
  async instruction(): Promise<string> {
    await this.ready();
    return build_federation_instruction(this.get_services());
  }

  /**
   * 执行 Federation 初始化。
   */
  private async initialize(prepare_database: boolean): Promise<void> {
    const state = await initialize_federation({
      runtime: this.runtime,
      services: this.get_services(),
      queue: this.queue,
      prepare_database,
      on_startup_timing: this.options.on_startup_timing,
    });

    this.table_map = state.table_map;
    this.authenticator = state.authenticator;
    this.hono = build_federation_router({
      runtime: this.runtime,
      services: this.get_services(),
      authenticator: state.authenticator,
      admin_store: state.admin_store,
      queue_available: () => this.queue.is_available(),
      table_map: state.table_map,
    });
  }

  /**
   * 确保初始化完成。
   */
  async ready(): Promise<void> {
    if (this.disposed) throw new Error("federation_disposed");
    if (!this.init_promise) {
      this.init_promise = measure_startup("total", () => this.initialize(
        this.options.database_initialization !== "prepared",
      ), this.options.on_startup_timing);
    }
    await this.init_promise;
  }

  /**
   * 迁移专用：只建立空表结构，不引导身份和密钥，供全量旧数据导入。
   * 导入并验证后必须调用 prepare_database() 完成索引和运行准备。
   */
  async prepare_schema(): Promise<void> {
    if (this.init_promise) throw new Error("Schema preparation requires a fresh Federation instance");
    await prepare_federation_schema(this.runtime, this.get_services());
  }

  /**
   * 部署阶段准备 schema、索引与系统数据，并验证 Service 可初始化。
   * 必须在该实例处理请求之前调用；失败应阻止发布，不能自动回退到在线迁移。
   */
  async prepare_database(): Promise<void> {
    if (this.init_promise) throw new Error("Database preparation requires a fresh Federation instance");
    this.init_promise = measure_startup("prepare_database", () => this.initialize(true), this.options.on_startup_timing);
    await this.init_promise;
  }

  /** 周期清理过期凭证；运行入口由宿主调度，不由用户请求触发。 */
  maintenance(): Promise<void> {
    return this.run_execution(async () => {
      await this.ready();
      const revocations = new UserTokenRevocationStore(
        this.runtime.database.table(this.runtime.builtinTables.federation_user_token_revocations),
        this.runtime.database,
      );
      await revocations.cleanup_expired();
      await this.authenticator!.user_sessions.cleanup();
      for (const service of this.get_services()) await maintain_service(service);
    });
  }

  /** 幂等释放 Federation 持有的资源。 */
  async dispose(): Promise<void> {
    if (!this.dispose_promise) {
      this.disposed = true;
      for (const controller of this.requests) controller.abort(new Error("Federation is disposed"));
      this.requests.clear();
      this.dispose_promise = (async () => {
        // 初始化和已进入业务的请求必须结束后才能关闭数据库。
        await this.init_promise?.catch(() => {});
        // 停止接收新执行后排空同一个登记表，覆盖 HTTP、队列和维护的完整业务阶段。
        await Promise.allSettled([...this.executions]);
        await this.runtime.database.dispose();
      })();
    }
    await this.dispose_promise;
  }

  /** 同步登记执行的完整生命周期，关闭门禁与排空只使用这一份事实源。 */
  private async run_execution<TResult>(handler: () => Promise<TResult>): Promise<TResult> {
    if (this.disposed) throw new Error("federation_disposed");
    // 立即进入 handler，使初始化在本次已接受的调用内开始；跨越 await 前完成登记。
    const release = this.execution_guard?.() ?? (() => {});
    let execution: Promise<TResult> | undefined;
    try {
      execution = handler();
      this.executions.add(execution);
      return await execution;
    } finally { if (execution) this.executions.delete(execution); release(); }
  }

  /** Service 装配在初始化前完成，避免路由与注册表形成两份事实。 */
  private assert_configuring(): void {
    if (this.disposed) throw new Error("federation_disposed");
    if (this.init_promise) throw new Error("Federation configuration is frozen after initialization begins");
  }

}
