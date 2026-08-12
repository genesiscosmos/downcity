/**
 * Federation 主模块。
 *
 * Federation 是城市基础设施运行容器，负责协调：
 * - service 注册
 * - runtime 初始化
 * - 鉴权器访问
 * - HTTP 路由暴露
 *
 * 具体初始化、路由构建、instruction 聚合等实现已拆到独立模块。
 */

import type { Hono, ExecutionContext as HonoExecutionContext } from "hono";
import { Service } from "../service/service.js";
import { asInstallableService, type ServiceDefinition } from "../service/installable-service.js";
import { EnvService } from "../service/env/env-service.js";
import { BureausService } from "../service/bureaus/bureaus-service.js";
import { build_federation_instruction } from "./federation-instruction.js";
import { initialize_federation } from "./federation-init.js";
import { build_federation_router } from "./federation-router.js";
import { create_federation_runtime } from "./federation-runtime.js";
import { FederationQueue } from "./queue.js";
import { run_federation_middlewares } from "./federation-middleware.js";
import type { FederationOptions, FederationHealthStatus, FederationFetchOptions } from "./types.js";
import type { FederationStorage } from "./storage.js";
import type { Authenticator } from "./auth/authenticator.js";
import type { Runtime } from "./runtime.js";
import type { CityTableApi } from "../store/table-api.js";
import type { BureauStore } from "../service/bureaus/bureau-store.js";
import type { BureauRecord } from "../types/Bureau.js";
import type { FederationMiddleware, FederationMiddlewareContext } from "../types/FederationMiddleware.js";

export class Federation {
  private readonly runtime: Runtime;
  readonly queue: FederationQueue;
  private readonly services = new Map<string, Service>();
  private readonly middlewares: FederationMiddleware[] = [];

  private table_map?: Map<string, CityTableApi>;
  private init_promise?: Promise<void>;
  private hono?: Hono;
  private authenticator?: Authenticator;
  private bureau_store?: BureauStore;

  constructor(options: FederationOptions) {
    this.runtime = create_federation_runtime(options);
    this.queue = new FederationQueue({
      ensure_ready: () => this.ensure_ready(),
      get_services: () => this.getServices(),
      get_table_map: () => {
        if (!this.table_map) throw new Error("Federation init has not completed yet");
        return this.table_map;
      },
      get_env: () => this.runtime.env,
      get_queue: () => this.queue,
      get_storage: () => this.runtime.storage,
    });
    this.use(new EnvService());
    this.use(new BureausService());
  }

  /**
   * 注册 Federation 默认存储后端。
   */
  storage(storage: FederationStorage): this {
    this.runtime.storage = storage;
    return this;
  }

  /**
   * 注册 service。
   */
  use(service_input: Service | ServiceDefinition): this {
    const service = "install" in service_input && !("get" in service_input)
      ? asInstallableService(service_input)
      : service_input;
    this.services.set((service as Service).id, service as Service);
    return this;
  }

  /**
   * 注册 Federation HTTP middleware。
   *
   * 关键说明（中文）
   * - middleware 在内部 Hono router 之前执行。
   * - 适合 CORS、body limit、rate limit、request id、timeout 等 HTTP 横切能力。
   * - 不用于依赖 `ctx.user` / `ctx.bureau` 的业务生命周期逻辑。
   */
  middle(...middlewares: FederationMiddleware[]): this {
    this.middlewares.push(...middlewares);
    return this;
  }

  /**
   * 获取单个 service。
   */
  getService(id: string): Service | undefined {
    return this.services.get(id);
  }

  /**
   * 获取所有已注册 service。
   */
  getServices(): Service[] {
    return [...this.services.values()];
  }

  /**
   * 获取鉴权器。
   */
  async getAuthenticator(): Promise<Authenticator> {
    await this.ensure_ready();
    return this.authenticator!;
  }

  /**
   * 获取表 API。
   */
  async table<TRow extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
  ): Promise<CityTableApi<TRow>> {
    await this.ensure_ready();
    const api = this.table_map?.get(name);
    if (!api) throw new Error(`Unknown schema table: ${name}`);
    return api as CityTableApi<TRow>;
  }

  /**
   * 处理 HTTP 请求。
   */
  readonly fetch = async (request: Request, options: FederationFetchOptions = {}): Promise<Response> => {
    await this.ensure_ready();
    const ctx: FederationMiddlewareContext = {
      request,
      execution: options.execution,
      runtime: this.runtime,
      federation: {
        services: () => this.getServices(),
      },
      locals: {},
    };

    return run_federation_middlewares(this.middlewares, ctx, () =>
      Promise.resolve(this.hono!.fetch(
        ctx.request,
        {
          trusted_identity: options.trusted_identity,
          transport: options.transport,
        },
        options.execution as HonoExecutionContext | undefined,
      )));
  };

  /**
   * 健康检查。
   */
  async health(): Promise<FederationHealthStatus> {
    await this.ensure_ready();
    const services = this.getServices();
    return {
      ok: true,
      name: "downcity",
      checked_at: new Date().toISOString(),
      services: services.map((service) => service.id),
      service_list: services.map((service) => ({ id: service.id, name: service.name })),
    };
  }

  /**
   * 聚合 instruction 文档。
   */
  async instruction(): Promise<string> {
    await this.ensure_ready();
    return build_federation_instruction(this.getServices());
  }

  /**
   * 执行 Federation 初始化。
   */
  private async initialize(): Promise<void> {
    const state = await initialize_federation({
      runtime: this.runtime,
      services: this.getServices(),
      require_ready: () => this.require_ready(),
      queue: this.queue,
    });

    this.table_map = state.table_map;
    this.bureau_store = state.bureau_store;
    this.authenticator = state.authenticator;
    this.hono = build_federation_router({
      runtime: this.runtime,
      services: this.getServices(),
      authenticator: state.authenticator,
      admin_store: state.admin_store,
      table_map: state.table_map,
    });
  }

  /**
   * 确保初始化完成。
   */
  private async ensure_ready(): Promise<void> {
    if (!this.init_promise) {
      this.init_promise = this.initialize();
    }
    await this.init_promise;
  }

  /** 幂等释放 Federation 主数据库。 */
  async dispose(): Promise<void> {
    await this.runtime.database.dispose();
  }

  /**
   * 给 Authenticator 延迟访问 Bureau Store。
   */
  private async require_ready(): Promise<{
    bureau: { get(id: string): Promise<BureauRecord | undefined> };
  }> {
    await this.ensure_ready();
    return {
      bureau: this.bureau_store ?? { get: () => Promise.resolve(undefined) },
    };
  }
}
