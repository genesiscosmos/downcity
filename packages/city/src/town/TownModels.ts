/**
 * 来源明确的 City 模型目录与执行路由。目录失败按来源隔离，文本句柄捕获身份，
 * 每次执行校验绑定并取得实际来源租约，不跨来源回退或重放计费调用。
 */
import { randomUUID } from "node:crypto";
import type { ModelClient, ModelCall, ModelStreamEvent, CityModelDescriptor, ModelReference, ClientModelReference } from "@downcity/type";
import type { DowntownUser } from "@downcity/downtown";
import { TownConnections, type TownConnectionState } from "./TownConnections.js";
import { is_model_reference, same_model } from "@downcity/type";
import { ExecutionLease, TownError, lease_stream } from "./ExecutionLease.js";
import { TownImageJobs } from "./TownImageJobs.js";
import type { TownExecutionOptions, TownOptions, TownSourceStatus } from "./types/Town.js";
import type { TownDirectModelRegistration, TownModelEntry, TownModelList, TownModelRequest, TownDecisionInput, TownImageInput, TownTtsInput, TownAsrInput } from "./types/TownModels.js";

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
  private readonly metadata = new Map<string, Map<string, TownModelEntry>>();
  private readonly jobs: TownImageJobs;

  constructor(private readonly connections: TownConnections, options: TownOptions = {}) {
    this.jobs = new TownImageJobs(connections, options);
  }

  /** 并行读取所有来源；失败来源只贡献自身错误，不吞掉其他目录。 */
  async list(options: { /** 只返回具备此能力的模型。 */ modality?: string; /** 取消本次目录读取。 */ signal?: AbortSignal } = {}): Promise<TownModelList> {
    options.signal?.throwIfAborted();
    const results = await Promise.all(this.connections.list().map(async (view) => {
      const state = this.connections.require(view.downtown_id);
      let release: (() => void) | undefined;
      try {
        release = this.connections.acquire(state);
        const items = await this.read_source(state, options.signal);
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

  /** 返回捕获当时身份的惰性客户端；同名裸 ID 不会被尝试或自动迁移。 */
  client(model: ModelReference, options: TownExecutionOptions = {}): TownModelClient {
    if (!is_model_reference(model)) throw new TownError("town_model_required");
    const reference = Object.freeze({ ...model });
    const direct = "client" in reference ? this.require_direct(reference) : undefined;
    const source_binding = direct?.binding_id ?? this.connections.require((reference as { downtown: string }).downtown).source.auth_scope_id;
    const binding_id = options.binding_id ?? source_binding;
    if (binding_id !== source_binding) throw new TownError("town_model_identity_confirmation_required");
    const metadata = "downtown" in reference ? this.metadata.get(reference.downtown)?.get(reference.id) : undefined;
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
      this.direct.clear(); this.metadata.clear();
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

  private async read_source(state: TownConnectionState, signal?: AbortSignal): Promise<TownModelEntry[]> {
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
    this.metadata.set(state.source.downtown_id, new Map(entries.map((entry) => [entry.id, entry])));
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
