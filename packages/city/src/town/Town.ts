/**
 * City 内唯一的 Town 公开入口。
 *
 * Town 管理多条独立 Downtown 连接、模型与 Service 聚合；不存在全局当前连接。
 * 宿主负责客户端创建、凭据交互与持久化，Town 只保存非秘密来源事实并提供受控路由。
 */
import type { Downtown, ServiceCatalogDetail, ServiceCatalogSummary, DowntownAccountProvider, FetchResponseLike, ServiceRequestOptions } from "@downcity/downtown";
import { TownConnections } from "./TownConnections.js";
import { TownModels } from "./TownModels.js";
import { TownError, lease_response } from "./ExecutionLease.js";
import type { TownConnection, TownLoginInput, TownLoginResult, TownOptions, TownRegistration, TownSource } from "./types/Town.js";
import type { TownModelList, TownModelRequest, TownDecisionInput, TownImageInput, TownTtsInput, TownAsrInput } from "./types/TownModels.js";
import type { TownModelClient } from "./TownModels.js";

/** Service 目录项保留所属连接与原始 Service ID。 */
export interface TownServiceEntry extends ServiceCatalogSummary {
  /** 目录来源连接。 */
  downtown_id: string;
  /** 该连接可读名称。 */
  source_name: string;
  /** 当前调用所需身份绑定。 */
  binding_id: string;
}

/** Service 聚合结果；单个来源失败不会抹掉其他来源。 */
export interface TownServiceList {
  /** 成功读取的 Service 项，不合并同名 ID。 */
  items: TownServiceEntry[];
  /** 每个连接的成功/失败状态。 */
  sources: Array<TownSource & { /** 本次目录读取结果。 */ status: "available" | "unavailable"; /** 有界错误码。 */ error_code?: string }>;
}

/** 由目标连接明确执行 Service Action；不会根据当前连接重路由。 */
export interface TownServiceCallInput {
  /** 目标连接。 */
  downtown_id: string;
  /** 目标连接内的原始 Service ID。 */
  service_id: string;
  /** Service 内原始 Action ID。 */
  action_id: string;
  /** JSON/raw 请求契约；method 与 body 由调用者按 Service 说明提供。 */
  request?: ServiceRequestOptions;
  /** 恢复后台工作时的身份绑定。 */
  binding_id?: string;
}

/** Town 的连接与聚合资源门面。 */
export class Town {
  /** 连接集合；Town 是其唯一的运行时登记事实源。 */
  readonly connections: TownConnections;
  /** 模型统一目录与执行路由。 */
  readonly models: TownModels;
  /** Service 统一目录与执行路由。 */
  readonly services: TownServices;
  private readonly options: TownOptions;
  private closed = false;

  constructor(private readonly city_id: string, options: TownOptions = {}) {
    this.options = options;
    this.connections = new TownConnections(city_id);
    this.models = new TownModels(this.connections, options);
    this.services = new TownServices(this.connections);
    for (const [downtown_id, registration] of Object.entries(options.connections ?? {})) {
      this.connections.add(downtown_id, registration.client, registration);
    }
  }

  /** 添加一条独立连接；稳定 ID 唯一，相同 endpoint 可以有独立来源，不能隐式合并授权。 */
  add(downtown_id: string, downtown: Downtown, options: Omit<TownRegistration, "client"> = {}): TownConnection {
    this.assert_open();
    return this.connections.add(downtown_id, downtown, options);
  }

  /** 获取连接级非秘密来源与受控用户视图。 */
  get(downtown_id: string): TownConnection { this.assert_open(); return this.connections.get(downtown_id); }

  /** 返回连接快照；不包含 Token、数据库或管理员访问器。 */
  list(): TownConnection[] { this.assert_open(); return this.connections.list(); }

  /** 替换连接客户端/身份；活跃租约存在时拒绝，不能覆盖在途请求。 */
  replace(downtown_id: string, registration: TownRegistration, expected_revision?: number, persist?: () => Promise<void>): Promise<TownConnection> {
    this.assert_open();
    return this.connections.replace(downtown_id, registration, expected_revision, persist);
  }

  /** 移除连接登记并隐藏其新资源；历史仓储由宿主保留。 */
  remove(downtown_id: string): Promise<TownConnection> { this.assert_open(); return this.connections.remove(downtown_id); }

  /** 改名只改投影，不改变来源、revision 或本地引用。 */
  rename(downtown_id: string, name: string): TownConnection { this.assert_open(); return this.connections.rename(downtown_id, name); }

  /** 读取指定连接的登录 Provider；无宿主适配器时直接读取公开 Accounts Service。 */
  async login_providers(downtown_id: string): Promise<DowntownAccountProvider[]> {
    const state = this.connections.require(downtown_id);
    const release = this.connections.acquire(state);
    try {
      const providers = this.options.auth?.login_providers
        ? await this.options.auth.login_providers(state.source)
        : await state.user.account.providers();
      this.connections.assert_current(state);
      return providers;
    } finally { release(); }
  }

  /** 交互登录由宿主实现；SDK 没有浏览器或凭据持久化能力时明确拒绝。 */
  async login(downtown_id: string, input: TownLoginInput): Promise<TownLoginResult> {
    this.assert_open();
    const auth = this.options.auth;
    if (!auth) throw new TownError("town_auth_adapter_required");
    const state = this.connections.require(downtown_id);
    const connection = { ...state.source };
    return auth.login({
      connection,
      commit: async (registration, persist) => this.connections.replace(downtown_id, registration, connection.revision, persist),
    }, input);
  }

  /** 退出只作用于目标连接；适配器决定远端撤销与本地 guest/无凭据注册。 */
  async logout(downtown_id: string): Promise<void> {
    this.assert_open();
    const auth = this.options.auth;
    if (!auth) throw new TownError("town_auth_adapter_required");
    const state = this.connections.require(downtown_id);
    await auth.logout({
      connection: { ...state.source },
      commit: async (registration, persist) => { await this.connections.replace(downtown_id, registration, state.source.revision, persist); return this.connections.get(downtown_id); },
    });
  }

  /** 关闭 Town 的执行入口；不会 dispose 宿主创建的 Downtown 实例。 */
  async close(): Promise<void> {
    if (this.closed) return;
    await this.models.close();
    await this.connections.close();
    this.closed = true;
  }

  private assert_open(): void { if (this.closed) throw new TownError("town_closed"); }
}

/** Service 聚合器；服务调用显式提供 downtown_id，避免计费来源漂移。 */
export class TownServices {
  constructor(private readonly connections: TownConnections) {}

  /** 并行读取各连接 Service 目录并隔离错误。 */
  async list(options: { /** 取消目录读取。 */ signal?: AbortSignal } = {}): Promise<TownServiceList> {
    const results = await Promise.all(this.connections.list().map(async (view) => {
      const state = this.connections.require(view.downtown_id);
      let release: (() => void) | undefined;
      try {
        release = this.connections.acquire(state);
        const items = await state.user.list_services();
        options.signal?.throwIfAborted();
        return { items: items.map((item) => ({ ...item, downtown_id: state.source.downtown_id, source_name: state.source.name, binding_id: state.source.auth_scope_id })), source: { ...state.source, status: "available" as const } };
      } catch (error) {
        return { items: [], source: { ...state.source, status: "unavailable" as const, error_code: service_error_code(error) } };
      } finally { release?.(); }
    }));
    return { items: results.flatMap((result) => result.items), sources: results.map((result) => result.source) };
  }

  /** 读取目标连接 Service 详情。 */
  async describe(downtown_id: string, service_id: string, signal?: AbortSignal): Promise<TownServiceEntry & { detail: ServiceCatalogDetail }> {
    const state = this.connections.require(downtown_id);
    const release = this.connections.acquire(state);
    try {
      const detail = await state.user.describe_service(service_id);
      this.connections.assert_current(state);
      return { ...detail, downtown_id, source_name: state.source.name, binding_id: state.source.auth_scope_id, detail };
    } finally { release(); }
  }

  /** 调用指定来源的原始 Action；保留 JSON/raw/stream 响应。 */
  async call(input: TownServiceCallInput): Promise<FetchResponseLike> {
    const state = this.connections.require(input.downtown_id);
    if (input.binding_id !== undefined && input.binding_id !== state.source.auth_scope_id) throw new TownError("town_service_identity_confirmation_required");
    const release = this.connections.acquire(state);
    try {
      const response = await state.user.service(input.service_id).request(input.action_id, input.request);
      this.connections.assert_current(state);
      // 原始用户请求没有连接门禁，租约须随 raw/stream 正文消费完成后释放。
      return lease_response(response, release, input.request?.signal);
    } catch (error) { release(); throw error; }
  }
}

function service_error_code(error: unknown): string {
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  if (status === 401 || status === 403) return "town_authorization_required";
  return "town_source_unavailable";
}
