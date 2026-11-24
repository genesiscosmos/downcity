/**
 * 来源明确的 City 模型目录与执行路由。目录失败按来源隔离，文本句柄捕获身份，
 * 每次执行校验绑定并取得实际来源租约，不跨来源回退或重放计费调用。
 * 目录快照只在同一连接代次与授权主体内保留 30 秒；精确解析和执行共享来源读取，
 * 并发等待分别支持取消，最后一个等待者离开时才中止底层请求。
 */
import { randomUUID } from "node:crypto";
import type { ModelClient, ModelCall, ModelStreamEvent, CityModelDescriptor, ModelReference, ClientModelReference } from "@downcity/type";
import type { DowntownUser } from "@downcity/downtown";
import { TownConnections, type TownConnectionState } from "./TownConnections.js";
import { is_model_reference, same_model } from "@downcity/type";
import { ExecutionLease, TownError, lease_stream } from "./ExecutionLease.js";
import { TownImageJobs } from "./TownImageJobs.js";
import type { TownExecutionOptions, TownOptions, TownSourceStatus } from "./types/Town.js";
import type { TownDirectModelRegistration, TownModelEntry, TownModelList, TownModelListOptions, TownModelResolveOptions, TownModelRequest, TownDecisionInput, TownImageInput, TownTtsInput, TownAsrInput } from "./types/TownModels.js";
import type { TownModelCatalogRequest, TownModelCatalogState } from "./types/TownModelCatalog.js";

/** 短期复用模型能力；授权与连接门禁仍在每次执行时实时核对。 */
const catalog_ttl_ms = 30_000;

/** 直接模型来源也拥有独立卸载门禁。 */
interface DirectModelState {
  /** 宿主提供的不可变登记参数。 */
  registration: TownDirectModelRegistration;
  /** 捕获的原始身份绑定；没有声明时只在当前注册存续期有效。 */
  binding_id: string;
  /** 此来源的实际执行租约。 */
  gate: ExecutionLease;
}

/** 包装器向 Agent 暴露身份快照，但不让 Agent 理解 Downtown。 */
export interface TownModelClient extends ModelClient {
  /** 此客户端所属 Downtown 与服务端模型的结构化引用。 */
  readonly model_reference: ModelReference;
  /** 宿主可持久化的不透明身份绑定；恢复时必须传回 resolver。 */
  readonly binding_id: string;
}

/** 统一文本、多模态目录与路由。 */
export class TownModels {
  private readonly direct = new Map<string, DirectModelState>();
  /** 替换或重新登记连接时对象身份变化，旧代次目录不会被新主体读取。 */
  private catalogs = new WeakMap<TownConnectionState, TownModelCatalogState>();
  private readonly jobs: TownImageJobs;

  constructor(private readonly connections: TownConnections, options: TownOptions = {}) {
    this.jobs = new TownImageJobs(connections, options);
  }

  /** 并行读取所有来源；失败来源只贡献自身错误，不吞掉其他目录。 */
  async list(options: TownModelListOptions = {}): Promise<TownModelList> {
    options.signal?.throwIfAborted();
    const results = await Promise.all(this.connections.list().map(async (view) => {
      const state = this.connections.require(view.downtown_id);
      let release: (() => void) | undefined;
      try {
        release = this.connections.acquire(state);
        const entries = await this.read_source(state, options.signal, options.refresh);
        const items = entries.map(entry => ({ ...structuredClone(entry), source_name: state.source.name }));
        options.signal?.throwIfAborted();
        return { items, source: { ...state.source, status: "available" } as TownSourceStatus };
      } catch (error) {
        return { items: [], source: { ...state.source, status: "unavailable", error_code: source_error_code(error) } as TownSourceStatus };
      } finally { release?.(); }
    }));
    options.signal?.throwIfAborted();
    const items = [...results.flatMap((result) => result.items), ...[...this.direct.values()].map((entry) => this.direct_entry(entry))];
    return { items: items.filter((entry) => !options.modality || entry.modalities.includes(options.modality)), sources: results.map((result) => result.source) };
  }

  /** 精确解析选定来源的模型；目录复用不放宽身份、能力或注册代次校验。 */
  async resolve(model: ModelReference, options: TownModelResolveOptions = {}): Promise<TownModelEntry> {
    options.signal?.throwIfAborted();
    if (!is_model_reference(model)) throw new TownError("town_model_required");
    if ("client" in model) {
      const state = this.require_direct(model);
      if (options.binding_id !== undefined && options.binding_id !== state.binding_id) throw new TownError("town_model_identity_confirmation_required");
      const release = state.gate.acquire();
      try {
        const entry = this.direct_entry(state);
        if (options.modality && !entry.modalities.includes(options.modality)) throw new TownError("town_model_capability_unavailable");
        return entry;
      } finally { release(); }
    }
    const state = this.connections.require(model.downtown);
    if (options.binding_id !== undefined && options.binding_id !== state.source.auth_scope_id) throw new TownError("town_model_identity_confirmation_required");
    const release = this.connections.acquire(state);
    try {
      const entries = await this.read_source(state, options.signal, options.refresh);
      options.signal?.throwIfAborted();
      this.connections.assert_current(state);
      const entry = entries.find(item => same_model(item.model, model));
      if (!entry) throw new TownError("town_model_not_found");
      if (options.modality && !entry.modalities.includes(options.modality)) throw new TownError("town_model_capability_unavailable");
      return { ...structuredClone(entry), source_name: state.source.name };
    } finally { release(); }
  }

  /** 返回捕获当时身份的惰性客户端；同名裸 ID 不会被尝试或自动迁移。 */
  client(model: ModelReference, options: TownExecutionOptions = {}): TownModelClient {
    if (!is_model_reference(model)) throw new TownError("town_model_required");
    const reference = Object.freeze({ ...model });
    const direct = "client" in reference ? this.require_direct(reference) : undefined;
    const source_binding = direct?.binding_id ?? this.connections.require((reference as { downtown: string }).downtown).source.auth_scope_id;
    const binding_id = options.binding_id ?? source_binding;
    if (binding_id !== source_binding) throw new TownError("town_model_identity_confirmation_required");
    const catalog = "downtown" in reference ? this.catalogs.get(this.connections.require(reference.downtown)) : undefined;
    const metadata = catalog && catalog.auth_scope_id === binding_id && catalog.expires_at > performance.now()
      ? catalog.items.find(entry => entry.id === reference.id) : undefined;
    return Object.freeze({
      id: reference.id, model_reference: reference, binding_id,
      name: metadata?.name ?? direct?.registration.client.name,
      context_window: metadata?.context_window ?? direct?.registration.client.context_window,
      model_stream_policy: direct?.registration.client.model_stream_policy,
      stream: async (call: ModelCall, signal?: AbortSignal): Promise<ReadableStream<ModelStreamEvent>> => {
        const execution_signal = combine_signals(options.signal, signal);
        execution_signal?.throwIfAborted();
        if ("client" in reference) {
          const entry = this.require_direct(reference);
          if (entry.binding_id !== binding_id) throw new TownError("town_model_identity_confirmation_required");
          const release = entry.gate.acquire();
          try { return lease_stream(await entry.registration.client.stream(call, execution_signal), release, execution_signal); }
          catch (error) { release(); throw error; }
        }
        return this.execute(reference, binding_id, "stream", async (state, original_model_id, release) => {
          const stream = await state.user.ai.model(original_model_id).stream(call, execution_signal);
          return lease_stream(stream, release, execution_signal);
        }, true, execution_signal);
      },
    });
  }

  /** 登记返回结构化引用，底层客户端 ID 和生命周期均保持原样。 */
  register(registration: TownDirectModelRegistration): ClientModelReference {
    if (!registration.source_id || !registration.client.id) throw new TownError("town_model_required");
    if (this.direct.has(registration.source_id)) throw new TownError("town_model_source_exists");
    const binding_id = registration.client.binding_id ?? `client:${randomUUID()}`;
    this.direct.set(registration.source_id, { registration: { ...registration }, binding_id, gate: new ExecutionLease() });
    return { client: registration.source_id, id: registration.client.id };
  }

  /** 忙时拒绝卸载；宿主在退登记成功后才释放原客户端。 */
  unregister(model: ClientModelReference): void {
    const state = this.require_direct(model);
    const end_change = state.gate.begin_change();
    try { state.gate.close(); this.direct.delete(model.client); }
    finally { end_change(); }
  }

  /** 结构化决策仍由模型所属服务计费。 */
  decision(request: TownModelRequest<TownDecisionInput>) {
    assert_business_input(request.input);
    return this.execute(request.model, request.binding_id, "decision", (state, model) => state.user.ai.decision({ ...request.input, model } as Parameters<DowntownUser["ai"]["decision"]>[0], request.signal), false, request.signal);
  }

  /** 创建前写入 pending，返回本地稳定句柄；失败结果未知时不会自动再次创建。 */
  image_create(request: TownModelRequest<TownImageInput>) {
    assert_business_input(request.input);
    const reference = request.model;
    return this.execute(reference, request.binding_id, "image", (state, model) => this.jobs.create(state, reference, { ...request.input, model } as Parameters<DowntownUser["ai"]["image_create"]>[0], request.signal), false, request.signal);
  }

  /** 查询只解析本地来源记录，不接受当前页面或当前模型覆盖来源。 */
  image_result(input: { /** Town 本地图片句柄。 */ job_id: string; /** 用户取消信号。 */ signal?: AbortSignal }) {
    return this.jobs.result(input.job_id, input.signal);
  }

  /** 语音合成保留原请求契约，加入正确的取消与来源门禁。 */
  tts(request: TownModelRequest<TownTtsInput>) {
    assert_business_input(request.input);
    return this.execute(request.model, request.binding_id, "tts", (state, model) => ai_json<Awaited<ReturnType<DowntownUser["ai"]["tts"]>>>(state.user, "tts", { ...request.input, model }, request.signal), false, request.signal);
  }

  /** 语音识别同样固定模型来源。 */
  asr(request: TownModelRequest<TownAsrInput>) {
    assert_business_input(request.input);
    return this.execute(request.model, request.binding_id, "asr", (state, model) => ai_json<Awaited<ReturnType<DowntownUser["ai"]["asr"]>>>(state.user, "asr", { ...request.input, model }, request.signal), false, request.signal);
  }

  /** 关闭前先统一检查直接模型，避免只退掉部分来源。 */
  async close(): Promise<void> {
    const end_changes: Array<() => void> = [];
    try {
      for (const state of this.direct.values()) end_changes.push(state.gate.begin_change());
      for (const state of this.direct.values()) state.gate.close();
      this.direct.clear(); this.catalogs = new WeakMap();
    } finally { for (const end of end_changes) end(); }
  }

  private async execute<T>(model: ModelReference, binding_id: string | undefined, modality: string,
    operation: (state: TownConnectionState, original_model_id: string, release: () => void) => Promise<T>,
    streaming: boolean, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (!is_model_reference(model)) throw new TownError("town_model_required");
    if (!("downtown" in model)) throw new TownError("town_model_capability_unavailable");
    const state = this.connections.require(model.downtown);
    if (binding_id !== undefined && binding_id !== state.source.auth_scope_id) throw new TownError("town_model_identity_confirmation_required");
    const release = this.connections.acquire(state);
    try {
      const entries = await this.read_source(state, signal);
      const entry = entries.find((item) => same_model(item.model, model));
      if (!entry) throw new TownError("town_model_not_found");
      if (!entry.modalities.includes(modality)) throw new TownError("town_model_capability_unavailable");
      signal?.throwIfAborted();
      this.connections.assert_current(state);
      const result = await operation(state, model.id, release);
      if (!streaming) release();
      return result;
    } catch (error) { release(); throw error; }
  }

  /** 同一连接代次共享目录读取；网络请求自己的租约覆盖所有等待者取消后的收口。 */
  private async read_source(state: TownConnectionState, signal?: AbortSignal, refresh = false): Promise<TownModelEntry[]> {
    signal?.throwIfAborted();
    this.connections.assert_current(state);
    let catalog = this.catalogs.get(state);
    if (!catalog || catalog.auth_scope_id !== state.source.auth_scope_id) {
      catalog = { auth_scope_id: state.source.auth_scope_id, items: [], expires_at: 0 };
      this.catalogs.set(state, catalog);
    }
    if (!refresh && catalog.expires_at > performance.now()) return catalog.items;
    let pending = catalog.pending;
    if (!pending) {
      const release = this.connections.acquire(state);
      const controller = new AbortController();
      const current_catalog = catalog;
      // 显式刷新失败后也不能继续使用刷新前的能力快照。
      current_catalog.expires_at = 0;
      const request: TownModelCatalogRequest = {
        controller, waiters: 0,
        promise: Promise.resolve().then(() => this.fetch_source(state, controller.signal)).then(items => {
          controller.signal.throwIfAborted();
          this.connections.assert_current(state);
          current_catalog.items = items;
          current_catalog.expires_at = performance.now() + catalog_ttl_ms;
          return items;
        }).finally(() => {
          if (current_catalog.pending === request) current_catalog.pending = undefined;
          release();
        }),
      };
      current_catalog.pending = request;
      pending = request;
    }
    return await this.wait_for_catalog(catalog, pending, signal);
  }

  /** 调用方取消只结束自己的等待；底层请求仍服务其他等待者。 */
  private wait_for_catalog(catalog: TownModelCatalogState, request: TownModelCatalogRequest, signal?: AbortSignal): Promise<TownModelEntry[]> {
    request.waiters += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (complete: () => void) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        request.waiters -= 1;
        complete();
      };
      const abort = () => {
        finish(() => reject(signal?.reason));
        if (!request.waiters && catalog.pending === request) {
          catalog.pending = undefined;
          request.controller.abort(signal?.reason);
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      request.promise.then(items => finish(() => resolve(items)), error => finish(() => reject(error)));
      if (signal?.aborted) abort();
    });
  }

  /** 仅成功且仍属于当前连接的完整目录可以发布到短期缓存。 */
  private async fetch_source(state: TownConnectionState, signal: AbortSignal): Promise<TownModelEntry[]> {
    signal.throwIfAborted();
    const response = await state.user.service("ai").request("models", { method: "GET", signal });
    const body = await response.json() as { /** 远端目录原始条目。 */ items: CityModelDescriptor[] };
    this.connections.assert_current(state);
    if (!Array.isArray(body.items)) throw new TownError("town_invalid_model_catalog");
    const seen = new Set<string>();
    const entries = body.items.map((descriptor) => {
      // 当前单服务模型协议会 trim 请求 ID；不接受会因此改变语义的目录项。
      if (typeof descriptor.id !== "string" || descriptor.id !== descriptor.id.trim() || !descriptor.id || !Array.isArray(descriptor.modalities)) throw new TownError("town_invalid_model_catalog");
      if (seen.has(descriptor.id)) throw new TownError("town_duplicate_model_id");
      seen.add(descriptor.id);
      const entry: TownModelEntry = {
        ...descriptor, model: { downtown: state.source.downtown_id, id: descriptor.id }, source_kind: "downtown", source_id: state.source.downtown_id,
        source_name: state.source.name, binding_id: state.source.auth_scope_id, durable: state.source.durable,
      };
      return entry;
    });
    return entries;
  }

  private require_direct(model: ClientModelReference): DirectModelState {
    const state = this.direct.get(model.client);
    if (!state || state.registration.client.id !== model.id) throw new TownError("town_model_source_unavailable");
    return state;
  }

  private direct_entry(state: DirectModelState): TownModelEntry {
    const { registration, binding_id } = state;
    return { model: { client: registration.source_id, id: registration.client.id }, id: registration.client.id,
      source_kind: "client", source_id: registration.source_id,
      source_name: registration.name ?? registration.source_id, name: registration.client.name ?? registration.client.id,
      model_type: "language", description: "", modalities: ["text", "stream"], tags: [], meta: {},
      context_window: registration.client.context_window, binding_id, durable: registration.durable === true,
    };
  }
}

/** 仅 Town 可注入路由字段，调用者不能在业务 input 中覆盖来源。 */
function assert_business_input(input: object): void {
  if (!input || typeof input !== "object" || Array.isArray(input) || "model" in input || "model_id" in input) throw new TypeError("town_model_routing_field_in_input");
}

/** 不重写 SDK/远端错误，目录只投影有界状态码。 */
export function source_error_code(error: unknown): string {
  if (error instanceof TownError) return error.code;
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  if (status === 401 || status === 403) return "town_authorization_required";
  if (status === 404) return "town_service_unavailable";
  return "town_source_unavailable";
}

/** 同时接受句柄与本次调用取消，任一方取消都会终止请求。 */
function combine_signals(first?: AbortSignal, second?: AbortSignal): AbortSignal | undefined {
  return first && second ? AbortSignal.any([first, second]) : first ?? second;
}

/** 普通 AI JSON 动作使用 SDK ServiceClient 保留鉴权与标准错误。 */
export async function ai_json<T>(user: Pick<DowntownUser, "service">, action: string, input: object, signal?: AbortSignal): Promise<T> {
  const response = await user.service("ai").request(action, { method: "POST", body: JSON.stringify(input), headers: { "content-type": "application/json" }, signal });
  return await response.json() as T;
}
