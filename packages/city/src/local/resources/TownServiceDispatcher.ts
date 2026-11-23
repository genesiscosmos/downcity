/**
 * Owner 侧 Town 服务发现及原始响应桥。只使用显式 Town 连接，不读取凭据。
 * JSON 管理通道只传状态、非秘密响应头和最多 64 KiB 的 base64 分块；
 * 实际响应 reader 留在该 owner 实例，直到 EOF、cancel、空闲过期或宿主释放。
 */
import { randomUUID } from "node:crypto";
import type { Town } from "../../town/Town.js";
import type { ServiceEndpointDetail, ServiceRequestOptions } from "@downcity/downtown";
import type { ResourceDispatcher } from "./ManagementChannel.js";
import { ResourceError, require_resource_value } from "./ResourceError.js";

export const TOWN_SERVICE_CAPABILITIES = ["town.service", "town.openapi", "town.call.open", "town.call.next", "town.call.cancel"] as const;
const CHUNK_BYTES = 64 * 1024;
const INPUT_BYTES = 8 * 1024 * 1024;
const IDLE_MS = 60_000;
const READ_WAIT_MS = 10_000;
const MAX_HANDLES = 32;

/** 已打开响应的可序列化元数据，不含 Response、Token 或用户资料。 */
export interface TownResponseOpen {
  /** 随机响应句柄，只在创建它的 owner/root 实例内有效。 */
  handle: string;
  /** 客户端为本次提交生成的唯一随机 ID，取消迟到 open 时也使用此值。 */
  request_id: string;
  /** 固定调用来源。 */
  downtown_id: string;
  /** 远端 HTTP 状态。 */
  status: number;
  /** 实际响应的有界内容/缓存头，不包含 set-cookie 等身份资料。 */
  headers: Record<string, string>;
}

/** 每次 next 最多一个有界字节块；pending 表示长轮询暂未读到字节。 */
export interface TownResponseChunk {
  /** EOF 后没有更多数据，owner 已释放 reader 和租约。 */
  done: boolean;
  /** 单次解码长度不超过 64 KiB；不会对文本或 SSE 做重编码。 */
  data?: string;
  /** 只用于无字节的长轮询返回，不表示流已经结束。 */
  pending?: boolean;
}

/** 只在当前 owner 内存中存在的执行事实。 */
interface ResponseState {
  /** 客户端请求标识，不接受重复提交重放。 */
  request_id: string;
  /** owner 随机分配的读取句柄。 */
  handle: string;
  /** 唯一连接来源。 */
  downtown_id: string;
  /** 开始发现时捕获的授权来源。 */
  binding_id: string;
  /** 取消网络请求与响应流。 */
  controller: AbortController;
  /** 正文 reader；open 期间尚未建立。 */
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  /** 上游超大 chunk 中未交付的剩余视图，不复制整个正文。 */
  remainder?: Uint8Array;
  /** 一次最多一个上游 read，长轮询不会重读。 */
  pending_read?: ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>;
  /** 禁止同一响应并发 next 导致乱序或重复字节。 */
  reading: boolean;
  /** 过期或取消后晚到的 open 不得再发布。 */
  closed: boolean;
  /** open 与客户端停读都有回收期限。 */
  timer?: ReturnType<typeof setTimeout>;
}

/** CLI 和 Desktop 的管理 dispatcher 均可组合一份；dispose 必须先于 Town.close。 */
export class TownServiceDispatcher implements ResourceDispatcher {
  readonly capabilities = TOWN_SERVICE_CAPABILITIES;
  private readonly states = new Map<string, ResponseState>();
  private closed = false;
  /** 有界短期去重记录：已完成的请求 ID 也不自动重发。 */
  private readonly submitted = new Map<string, number>();

  constructor(private readonly town: Town) {}

  async dispatch(method: string, input: Record<string, unknown>): Promise<unknown> {
    require_resource_value(!this.closed, "Town service bridge is closed");
    const downtown_id = required_text(input.downtown_id, "downtown_id");
    try {
      if (method === "town.service") return bounded_document(await this.town.services.describe(downtown_id, required_text(input.service_id, "service_id")));
      if (method === "town.openapi") return bounded_document(await this.town.get(downtown_id).user.openapi());
      if (method === "town.call.open") return await this.open(downtown_id, input);
      if (method === "town.call.cancel") {
        const request_id = required_text(input.request_id, "request_id");
        const state = this.states.get(request_id);
        if (!state) return { cancelled: false }; // EOF/timeout/cancel 后幂等。
        this.assert_owner(state, downtown_id, input.handle);
        await this.release(state);
        return { cancelled: true };
      }
      if (method === "town.call.next") {
        const state = this.states.get(required_text(input.request_id, "request_id"));
        if (!state) throw new ResourceError("response_expired", "Response is closed or expired; the action will not be replayed", 4);
        this.assert_owner(state, downtown_id, required_text(input.handle, "handle"));
        return await this.next(state);
      }
      throw new ResourceError("capability_missing", "Unsupported Town service operation", 5);
    } catch (error) {
      if (error instanceof ResourceError) throw error;
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      if (typeof status === "number") throw new ResourceError("downtown_http_error", `Downtown request failed (HTTP ${status})`, 1, false, { status });
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      throw new ResourceError(typeof code === "string" && code.startsWith("town_") ? code : "downtown_service_failed", "Downtown service request failed", 1);
    }
  }

  /** 取消本桥全部在途 open/read；不处置 Town 或 SDK 客户端。 */
  async dispose(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.states.values()].map((state) => this.release(state)));
  }

  private async open(downtown_id: string, input: Record<string, unknown>): Promise<TownResponseOpen> {
    require_resource_value(input.admin !== true, "Administrator service calls are not supported by the Town user bridge");
    const request_id = required_text(input.request_id, "request_id");
    require_resource_value(/^[a-f\d-]{36}$/u.test(request_id), "A random request_id is required");
    for (const [id, expires_at] of this.submitted) if (expires_at <= Date.now()) this.submitted.delete(id);
    require_resource_value(!this.submitted.has(request_id) && !this.states.has(request_id), "This request_id has already been submitted; actions are never replayed");
    if (this.submitted.size >= 4096) throw new ResourceError("resource_busy", "Service request directory is full; retry later with a new request", 4);
    if (this.states.size >= MAX_HANDLES) throw new ResourceError("resource_busy", "Too many open service responses; finish or cancel an earlier call", 4);
    const state: ResponseState = { request_id, handle: randomUUID(), downtown_id,
      binding_id: this.town.get(downtown_id).auth_scope_id, controller: new AbortController(), reading: false, closed: false };
    this.submitted.set(request_id, Date.now() + 300_000);
    this.states.set(request_id, state);
    this.touch(state);
    try {
      const service_id = required_text(input.service_id, "service_id");
      const action_id = required_text(input.action_id, "action_id");
      const described = await this.town.services.describe(downtown_id, service_id, state.controller.signal);
      const action = described.detail.actions.find((entry) => entry.id === action_id);
      require_resource_value(action && action.kind === "action", "Action is not registered; native routes cannot be called here");
      const request = action_request(action, input.raw_input, state.controller.signal);
      state.controller.signal.throwIfAborted();
      // describe 与实际发送之间换号时，由原 binding 拒绝；不悄悄接受新身份。
      const response = await this.town.services.call({ downtown_id, service_id, action_id, binding_id: state.binding_id, request });
      if (state.closed) { await response.body?.cancel().catch(() => {}); throw new Error("Service response cancelled"); }
      state.reader = (response.body ?? new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } })).getReader();
      const headers: Record<string, string> = {};
      for (const key of ["content-type", "content-length", "content-disposition", "cache-control", "etag", "last-modified", "retry-after"]) {
        const value = response.headers?.get(key);
        if (value && value.length <= 4096) headers[key] = value;
      }
      this.touch(state);
      return { handle: state.handle, request_id, downtown_id, status: response.status, headers };
    } catch (error) { await this.release(state); throw error; }
  }

  private async next(state: ResponseState): Promise<TownResponseChunk> {
    if (state.reading) throw new ResourceError("resource_busy", "Only one response read may be active", 4);
    require_resource_value(state.reader, "Service response is not open yet");
    state.reading = true;
    this.touch(state);
    let read_timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (state.remainder?.byteLength) return this.chunk(state, state.remainder);
      state.pending_read ??= state.reader.read();
      const result = await Promise.race([state.pending_read, new Promise<undefined>((resolve) => { read_timer = setTimeout(() => resolve(undefined), READ_WAIT_MS); })]);
      if (state.closed) throw new ResourceError("response_expired", "Service response expired or was cancelled", 4);
      if (!result) return { done: false, pending: true };
      state.pending_read = undefined;
      if (result.done) { await this.release(state); return { done: true }; }
      return this.chunk(state, result.value);
    } catch (error) { await this.release(state); throw error; }
    finally { if (read_timer) clearTimeout(read_timer); state.reading = false; if (!state.closed) this.touch(state); }
  }

  private chunk(state: ResponseState, bytes: Uint8Array): TownResponseChunk {
    const value = bytes.subarray(0, CHUNK_BYTES);
    state.remainder = bytes.byteLength > CHUNK_BYTES ? bytes.subarray(CHUNK_BYTES) : undefined;
    return { done: false, data: Buffer.from(value).toString("base64") };
  }

  private assert_owner(state: ResponseState, downtown_id: string, handle: unknown): void {
    // request_id 可用于取消尚未返回的 open；next 必须同时持有 owner 句柄。
    if (state.downtown_id !== downtown_id || handle !== undefined && handle !== state.handle) throw new ResourceError("response_not_found", "Response handle does not belong to this request source", 3);
  }

  private touch(state: ResponseState): void {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => { void this.release(state); }, IDLE_MS);
    state.timer.unref();
  }

  private async release(state: ResponseState): Promise<void> {
    if (state.closed) return;
    state.closed = true;
    if (state.timer) clearTimeout(state.timer);
    this.states.delete(state.request_id);
    state.controller.abort(new Error("Service response closed"));
    state.pending_read?.catch(() => {});
    try { await state.reader?.cancel(); } catch { /* 原请求已终止，清理不恢复句柄。 */ }
    try { state.reader?.releaseLock(); } catch { /* 在途 read 由 abort/cancel 收口。 */ }
    state.remainder = undefined;
  }
}

/** 请求正文只接受受限文本；具体 Action schema 仍由 Downtown 原服务校验。 */
function action_request(action: ServiceEndpointDetail, raw_input: unknown, signal: AbortSignal): ServiceRequestOptions {
  require_resource_value(raw_input === undefined || typeof raw_input === "string", "raw_input must be text");
  const raw = typeof raw_input === "string" ? raw_input : undefined;
  require_resource_value(!raw || Buffer.byteLength(raw) <= INPUT_BYTES, "Service input exceeds 8 MiB");
  require_resource_value(action.method === "GET" || action.method === "POST", "Unsupported Action HTTP method");
  if (action.method === "GET") return { method: "GET", query: object_input(raw), signal };
  return { method: "POST", body: action.body === "raw" ? raw ?? "" : JSON.stringify(object_input(raw)), signal,
    headers: { "content-type": action.documentation?.request_content_type ?? (action.body === "raw" ? "text/plain" : "application/json") } };
}

function object_input(raw?: string): Record<string, unknown> {
  let value: unknown;
  try { value = raw?.trim() ? JSON.parse(raw) : {}; } catch { throw new ResourceError("validation_error", "Action input must be a JSON object", 2); }
  require_resource_value(value && typeof value === "object" && !Array.isArray(value), "Action input must be a JSON object");
  return value as Record<string, unknown>;
}

function required_text(value: unknown, field: string): string {
  require_resource_value(typeof value === "string" && value.length > 0 && value === value.trim(), `${field} is required`);
  return value;
}

/** 公开发现不超过本机 JSON 管理帧；超大文档明确失败，避免截断或无限等待。 */
function bounded_document<T>(document: T): T {
  if (Buffer.byteLength(JSON.stringify(document)) > 8 * 1024 * 1024) throw new ResourceError("response_too_large", "Service document exceeds the 8 MiB management limit", 1);
  return document;
}
