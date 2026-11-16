/**
 * Federation 统一入口：本地通过标准 Request/Response 调用内核，远端通过 HTTP。
 * user 与 admin 共享传输但各自持有身份。公开 fetch 是本地服务端入口，
 * 只采用请求自己的凭证或宿主显式传入的可信身份，绝不继承客户端凭证。
 * 宿主创建并最终 dispose；注入 City 不转移所有权。
 */
import { FederationRuntime } from "../federation/federation.js";
import type { FederationFetchOptions, FederationHealthStatus } from "../federation/types.js";
import type { FederationStorage } from "../federation/storage.js";
import type { FederationMiddleware } from "../types/FederationMiddleware.js";
import type { Service } from "../service/service.js";
import type { ServiceDefinition } from "../service/installable-service.js";
import { defaultFetch, requestJSON, type FetchLike } from "../pact/http.js";
import { FederationAdmin } from "./FederationAdmin.js";
import { FederationUser } from "./FederationUser.js";
import { track_response } from "./response-lifetime.js";
import { normalize_federation_url } from "./url.js";
import type { FederationOptions } from "./types/FederationOptions.js";

/** 账户、AI、业务服务与本地运行资源的唯一公开入口。 */
export class Federation {
  /** 连接目录使用的稳定本地 ID；与登录态及展示名无关。 */
  readonly id: string;
  /** 用户可见连接名称。 */
  readonly name: string;
  /** 用户业务访问；使用独立 User Token。 */
  readonly user: FederationUser;
  /** 管理访问；要求独立 Admin Session。 */
  readonly admin: FederationAdmin;
  /** 当前执行位置，由构造配置推导。 */
  readonly mode: "local" | "remote";
  /** 远端基础地址；本地实例使用仅用于构造 Request 的逻辑地址。 */
  readonly url: string;
  private readonly runtime?: FederationRuntime;
  private readonly fetcher: FetchLike;
  private disposed = false;
  /** 宿主借用门禁；资源唯一 owner 可阻止替换期间进入新请求。 */
  private request_guard?: () => () => void;

  /** 显式借用长期连接；调用者须在解除绑定或丢弃句柄时释放，项目替换会检查此租约。 */
  retain(): () => void { this.assert_open(); return this.request_guard?.() ?? (() => {}); }

  /** 绑定宿主执行门禁；返回只撤销本次绑定的释放函数。 */
  guard_requests(acquire: () => () => void): () => void {
    if (this.request_guard) throw new Error("Federation request guard is already installed");
    this.request_guard = acquire;
    this.runtime?.guard_execution(acquire);
    return () => { if (this.request_guard === acquire) { this.request_guard = undefined; this.runtime?.guard_execution(undefined); } };
  }
  private dispose_promise?: Promise<void>;
  private readonly requests = new Set<AbortController>();

  constructor(options: FederationOptions) {
    if (!options || typeof options !== "object" || (options.database !== undefined) === (options.url !== undefined)) {
      throw new TypeError("Federation requires exactly one of database or url");
    }
    if (options.database !== undefined && (!options.database || typeof options.database !== "object")) {
      throw new TypeError("Federation database must be a Database Adapter");
    }
    this.mode = options.database ? "local" : "remote";
    if (this.mode === "remote" && typeof options.url !== "string") {
      throw new TypeError("Federation url must be an HTTP(S) address");
    }
    this.url = normalize_federation_url(options.url ?? "https://federation.invalid");
    if (options.id !== undefined && (typeof options.id !== "string" || !options.id.trim())) throw new TypeError("Federation id must be a nonempty string");
    if (options.name !== undefined && typeof options.name !== "string") throw new TypeError("Federation name must be a string");
    this.id = options.id?.trim() ?? (this.mode === "local" ? "local" : this.url);
    this.name = options.name?.trim() || this.id;
    if (options.database) {
      if (options.fetch !== undefined) throw new TypeError("Local Federation does not accept fetch");
      this.runtime = new FederationRuntime(options);
    }
    const network_fetch = this.runtime ? undefined : options.fetch ?? defaultFetch();
    this.fetcher = async (url, init) => {
      this.assert_open();
      if (this.runtime) {
        const target = new URL(url);
        if (target.origin !== new URL(this.url).origin) {
          throw new TypeError("Local Federation cannot dispatch to an external origin");
        }
        return this.fetch(new Request(url, init));
      }
      const release = this.request_guard?.() ?? (() => {});
      const controller = new AbortController();
      const abort = () => controller.abort(init.signal?.reason);
      if (init.signal?.aborted) abort();
      else init.signal?.addEventListener("abort", abort, { once: true });
      this.requests.add(controller);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        release();
        this.requests.delete(controller);
        init.signal?.removeEventListener("abort", abort);
      };
      try {
        const response = await network_fetch!(url, { ...init, signal: controller.signal });
        if (controller.signal.aborted) {
          await response.body?.cancel(controller.signal.reason);
          throw controller.signal.reason;
        }
        if (!response.body) { finish(); return response; }
        const headers = new Headers();
        response.headers?.forEach((value, key) => headers.append(key, value));
        return track_response(new Response(response.body, { status: response.status, headers }), controller.signal, finish);
      } catch (error) { finish(); throw error; }
    };
    this.user = new FederationUser({ url: this.url, user_token: options.user_token, fetch: this.fetcher });
    this.admin = new FederationAdmin({ url: this.url, admin_token: options.admin_token, fetch: this.fetcher });
  }

  /** 等待本地服务准备完成；远端不探测网络或改变登录态。 */
  async ready(): Promise<void> {
    this.assert_open();
    await this.runtime?.ready();
  }

  /** 本地服务端请求入口，可信身份仅允许从第二参数显式传入。 */
  readonly fetch = async (request: Request, options?: FederationFetchOptions): Promise<Response> => {
    const release = this.request_guard?.() ?? (() => {});
    try { return track_response(await this.require_runtime().fetch(request, options), request.signal, release); }
    catch (error) { release(); throw error; }
  };

  /** 注册本地 Service。 */
  use(service: Service | ServiceDefinition): this { this.require_runtime().use(service); return this; }
  /** 注册本地 HTTP 中间件。 */
  middle(...middlewares: FederationMiddleware[]): this { this.require_runtime().middle(...middlewares); return this; }
  /** 配置本地服务默认媒体存储。 */
  storage(storage: FederationStorage): this { this.require_runtime().storage(storage); return this; }
  /** 本地异步队列，由宿主显式装配 Adapter。 */
  get queue(): FederationRuntime["queue"] { return this.require_runtime().queue; }
  /** 获取本地已注册 Service。 */
  get_service(id: string): Service | undefined { return this.require_runtime().get_service(id); }
  /** 本地 Service 快照。 */
  get_services(): Service[] { return this.require_runtime().get_services(); }
  /** 本地受信宿主表访问能力。 */
  table<TRow extends Record<string, unknown> = Record<string, unknown>>(name: string) {
    return this.require_runtime().table<TRow>(name);
  }
  /** 部署阶段只准备数据库结构。 */
  prepare_schema(): Promise<void> { return this.require_runtime().prepare_schema(); }
  /** 部署阶段准备数据库和 Service。 */
  prepare_database(): Promise<void> { return this.require_runtime().prepare_database(); }
  /** 宿主周期维护。 */
  maintenance(): Promise<void> { return this.require_runtime().maintenance(); }
  /** 本地 Service 聚合说明。 */
  instruction(): Promise<string> { return this.require_runtime().instruction(); }
  /** 两种执行位置返回相同的健康协议。 */
  async health(): Promise<FederationHealthStatus> {
    this.assert_open();
    return this.runtime ? this.runtime.health() : requestJSON<FederationHealthStatus>({
      fetch: this.fetcher, url: this.url + "/health", init: { method: "GET" },
    });
  }
  /** 幂等终止当前客户端请求，再释放本地运行资源；不会停止远端服务。 */
  dispose(): Promise<void> {
    if (!this.dispose_promise) {
      this.disposed = true;
      for (const request of this.requests) request.abort(new Error("Federation is disposed"));
      this.requests.clear();
      this.user.clear_credentials();
      this.admin.clear_credentials();
      this.dispose_promise = this.runtime?.dispose() ?? Promise.resolve();
    }
    return this.dispose_promise;
  }
  private assert_open(): void {
    if (this.disposed) throw new Error("federation_disposed");
  }
  private require_runtime(): FederationRuntime {
    this.assert_open();
    if (!this.runtime) throw new Error("federation_local_required");
    return this.runtime;
  }
}
