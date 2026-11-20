/**
 * RemoteAgent HTTP transport。
 *
 * 关键点（中文）
 * - 只适配 downcity Agent HTTP gateway 的 SDK routes。
 * - 不处理 RemoteSession 的 turn lifecycle，避免 transport 与 actor 逻辑混在一起。
 */

import { SESSION_TYPE_WORK } from "@downcity/type";
import type { SessionModelRetryHttpPayload } from "@/types/remote/SessionModelRetry.js";
import type { AgentInteraction, AgentInteractionChange, AgentListInteractionsInput, AgentRespondInteractionInput } from "@downcity/agent";
import type { RemoteInteractionSubscriptionInput } from "@/types/remote/RemoteAgentInteractions.js";
import { validate_interaction_list_input, validate_interaction_response_input } from "@/remote/InteractionValidation.js";
import type {
  AgentCreateSessionInput,
  AgentListSessionsInput,
  AgentArchiveSessionInput,
  AgentArchiveSessionsInput,
  AgentArchiveSessionResult,
  AgentArchiveSessionsResult,
  AgentCleanArchiveResult,
  AgentSessionForkInput,
  AgentSessionInfo,
  AgentSessionSetOptions,
  AgentSessionStatus,
  AgentSessionSummaryPage,
  AgentSessionSystemSnapshot,
  RemoteSessionSetInput,
} from "@downcity/agent";
import type {
  ListSessionMessagesInput,
  SessionMessagePage,
} from "@downcity/agent";
import type {
  RemoteAgentPowerActionInput,
  RemoteAgentPowerActionResult,
} from "@/types/remote/RemoteAgentPowerAction.js";
import type { SessionMutation } from "@downcity/agent";
import type { RemotePromptInput, OpenPromptPowerChannel, PromptPowerChannel } from "@/types/remote/PromptPowerTransport.js";
import { open_http_power_channel } from "./HttpPromptPowerChannel.js";
import type { AgentSessionStopResult } from "@downcity/agent";
import type {
  RemoteAgentTransport,
  TransportSubscription,
} from "@/remote/RemoteTransport.js";
import type {
  RespondSessionInteractionInput,
  SessionInteractionResult,
  SessionInteractionRequest,
} from "@downcity/agent";

type SdkEventsReadyFrame = {
  /** SDK HTTP events 连接内部 ready 标记。 */
  type: "sdk-events-ready";
};

/**
 * downcity HTTP gateway transport。
 */
export class HttpRemoteAgentTransport implements RemoteAgentTransport {
  private readonly base_url: string;
  private readonly token: string;
  private closed = false;
  private readonly resources = new Set<() => Promise<void>>();

  constructor(url: string, token?: string) {
    this.base_url = url.replace(/\/+$/, "");
    this.token = String(token || "").trim();
  }

  private headers(input?: Record<string, string>): Headers {
    if (this.closed) throw new Error("Remote City connection closed");
    const headers = new Headers(input);
    if (this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }
    return headers;
  }

  /** 构建携带确定性来源分区的单 Session URL。 */
  private session_url(session_id: string, type: string | undefined, suffix = ""): string {
    const query = new URLSearchParams(type ? { type } : undefined);
    return `${this.base_url}/api/sdk/sessions/${encodeURIComponent(session_id)}${suffix}?${query.toString()}`;
  }

  async create_session(input?: AgentCreateSessionInput): Promise<AgentSessionInfo> {
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      session?: AgentSessionInfo;
    }>(`${this.base_url}/api/sdk/sessions`, {
      method: "POST",
      headers: this.headers({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(input ?? {}),
    });
    if (!payload.success || !payload.session?.id) {
      throw new Error(String(payload.error || "Remote session create failed"));
    }
    return payload.session;
  }

  async get_info(session_id: string, type?: string): Promise<AgentSessionInfo> {
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      session?: AgentSessionInfo;
    }>(this.session_url(session_id, type), {
      headers: this.headers(),
    });
    if (!payload.success || !payload.session?.id) {
      throw new Error(String(payload.error || "Remote session info failed"));
    }
    return payload.session;
  }

  async prompt(
    session_id: string,
    type: string,
    input: RemotePromptInput,
  ): Promise<import("@/types/remote/RemoteTurn.js").RemotePromptTurn> {
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      turn?: import("@/types/remote/RemoteTurn.js").RemotePromptTurn;
    }>(this.session_url(session_id, type, "/prompt"), {
      method: "POST",
      headers: this.headers({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(input),
    });
    const id = String(payload.turn?.id || "").trim();
    if (!payload.success || !id) {
      throw new Error(String(payload.error || "Remote session prompt failed"));
    }
    return { id, result: payload.turn?.result ?? null };
  }

  async open_power_channel(input: OpenPromptPowerChannel): Promise<PromptPowerChannel> {
    const channel = await open_http_power_channel(this.session_url(input.session_id, input.type, "/power-executions/events"), this.headers(), input);
    const close = async () => { this.resources.delete(close); await channel.close(); };
    if (this.closed) { await channel.close(); throw new Error("Remote City connection closed"); }
    this.resources.add(close);
    return { id: channel.id, result: (result) => channel.result(result), close };
  }

  async stop(session_id: string, type: string, expected_turn_id?: string, expected_message?: import("@downcity/type").SessionMessageCheckpoint): Promise<AgentSessionStopResult> {
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      result?: AgentSessionStopResult;
    }>(this.session_url(session_id, type, "/stop"), {
      method: "POST",
      body: JSON.stringify({ expected_turn_id, expected_message }),
      headers: this.headers({
        "Content-Type": "application/json",
      }),
    });
    if (!payload.success || !payload.result) {
      throw new Error(String(payload.error || "Remote session stop failed"));
    }
    return payload.result;
  }

  async subscribe(params: {
    session_id: string;
    type: string;
    on_ready: () => void;
    on_event: (event: SessionMutation) => void;
    on_close: (error?: unknown) => void;
  }): Promise<TransportSubscription> {
    const abort_controller = new AbortController();
    let resolve_ready!: () => void;
    let reject_ready!: (error: unknown) => void;
    const ready_promise = new Promise<void>((resolve, reject) => {
      resolve_ready = resolve;
      reject_ready = reject;
    });
    const response = await fetch(
      this.session_url(params.session_id, params.type, "/events"),
      {
        headers: this.headers(),
        signal: abort_controller.signal,
      },
    );
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `Remote session events failed (${response.status})`);
    }
    void consume_http_event_stream({
      body: response.body,
      abort_controller,
      on_ready: () => {
        params.on_ready();
        resolve_ready();
      },
      on_ready_error: (error) => {
        reject_ready(error);
      },
      on_event: params.on_event,
    }).then((error) => {
      if (!abort_controller.signal.aborted) {
        params.on_close(error);
      }
    });
    await ready_promise;
    const close = async () => {
      this.resources.delete(close);
      abort_controller.abort();
      params.on_close(new Error("Remote City connection closed"));
    };
    if (this.closed) { await close(); throw new Error("Remote City connection closed"); }
    this.resources.add(close);
    return { close: async () => { this.resources.delete(close); abort_controller.abort(); } };
  }

  /** 连接拥有者关闭时释放事件流与调用方执行通道。 */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const results = await Promise.allSettled([...this.resources].map((close) => close()));
    this.resources.clear();
    const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, "Remote City connection close failed");
  }

  async messages(
    session_id: string,
    type: string,
    input?: ListSessionMessagesInput,
  ): Promise<SessionMessagePage> {
    const query = new URLSearchParams(type ? { type } : undefined);
    if (input?.before_sequence !== undefined) {
      query.set("before_sequence", String(input.before_sequence));
    }
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      messages?: SessionMessagePage;
    }>(
      `${this.base_url}/api/sdk/sessions/${encodeURIComponent(session_id)}/messages?${query.toString()}`,
      {
        headers: this.headers(),
      },
    );
    if (!payload.success || !payload.messages || !Array.isArray(payload.messages.items)) {
      throw new Error(String(payload.error || "Remote session messages failed"));
    }
    return payload.messages;
  }

  async system(session_id: string, type: string): Promise<AgentSessionSystemSnapshot> {
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      system?: AgentSessionSystemSnapshot;
    }>(this.session_url(session_id, type, "/system"), {
      headers: this.headers(),
    });
    if (!payload.success || !payload.system || !Array.isArray(payload.system.blocks)) {
      throw new Error(String(payload.error || "Remote session system failed"));
    }
    return payload.system;
  }

  async fork(
    session_id: string,
    type: string,
    input?: AgentSessionForkInput | string,
  ): Promise<AgentSessionInfo> {
    const message_id =
      typeof input === "string"
        ? String(input || "").trim() || undefined
        : String(input?.message_id || "").trim() || undefined;
    const include_message = typeof input === "string" || input?.include_message !== false;
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      session?: AgentSessionInfo;
    }>(this.session_url(session_id, type, "/fork"), {
      method: "POST",
      headers: this.headers({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        ...(message_id ? { message_id: message_id } : {}),
        ...(message_id && !include_message ? { include_message: false } : {}),
        ...(typeof input !== "string" && input?.replace === true ? { replace: true } : {}),
      }),
    });
    if (!payload.success || !payload.session?.id) {
      throw new Error(String(payload.error || "Remote session fork failed"));
    }
    return payload.session;
  }

  async list_sessions(input?: AgentListSessionsInput): Promise<AgentSessionSummaryPage> {
    const query = new URLSearchParams();
    query.set("type", input?.type || SESSION_TYPE_WORK);
    if (input?.kind) query.set("kind", input.kind);
    if (input?.limit !== undefined) query.set("limit", String(input.limit));
    if (input?.cursor) query.set("cursor", input.cursor);
    if (input?.query) query.set("query", input.query);
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      page?: AgentSessionSummaryPage;
    }>(
      `${this.base_url}/api/sdk/sessions?${query.toString()}`,
      {
        headers: this.headers(),
      },
    );
    if (!payload.success || !payload.page) {
      throw new Error(String(payload.error || "Remote sessions list failed"));
    }
    return payload.page;
  }

  async archive_session(
    input: AgentArchiveSessionInput,
  ): Promise<AgentArchiveSessionResult> {
    const session_id = String(input?.id || "").trim();
    if (!session_id) {
      throw new Error("archive_session requires a non-empty id");
    }
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      session_id?: string;
      archived_at?: number;
      operation_id?: string;
      root_session_id?: string;
      plan_fingerprint?: string;
      changed?: boolean;
    }>(
      this.session_url(session_id, input.type || SESSION_TYPE_WORK, "/archive"),
      {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ operation_id: input.operation_id, root_session_id: input.root_session_id }),
      },
    );
    if (!payload.success || !payload.session_id) {
      throw Object.assign(new Error(String(payload.error || "Remote session archive failed")), {
        operation_id: payload.operation_id ?? input.operation_id, root_session_id: payload.root_session_id ?? input.root_session_id,
        plan_fingerprint: payload.plan_fingerprint,
      });
    }
    return {
      session_id: payload.session_id, operation_id: payload.operation_id, root_session_id: payload.root_session_id,
      plan_fingerprint: payload.plan_fingerprint, changed: payload.changed,
      ...(typeof payload.archived_at === "number" ? { archived_at: payload.archived_at } : {}),
    };
  }

  async archive_sessions(
    input?: AgentArchiveSessionsInput,
  ): Promise<AgentArchiveSessionsResult> {
    const query = new URLSearchParams();
    query.set("type", input?.type || SESSION_TYPE_WORK);
    if (input?.kind) query.set("kind", input.kind);
    if (input?.limit !== undefined) query.set("limit", String(input.limit));
    if (input?.cursor) query.set("cursor", input.cursor);
    if (input?.query) query.set("query", input.query);
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      page?: AgentArchiveSessionsResult;
    }>(
      `${this.base_url}/api/sdk/archived-sessions?${query.toString()}`,
      {
        headers: this.headers(),
      },
    );
    if (!payload.success || !payload.page) {
      throw new Error(String(payload.error || "Remote archived sessions list failed"));
    }
    return payload.page;
  }

  async archived_snapshot(session_id: string): Promise<import("@downcity/agent").SessionArchivedSnapshot> {
    return await this.archived_read(session_id, "");
  }
  async archived_messages(session_id: string, input?: ListSessionMessagesInput): Promise<SessionMessagePage> {
    const query = new URLSearchParams();
    if (input?.limit !== undefined) query.set("limit", String(input.limit));
    if (input?.before_sequence !== undefined) query.set("before_sequence", String(input.before_sequence));
    return await this.archived_read(session_id, `/messages?${query}`);
  }
  async archived_configuration(session_id: string): Promise<import("@downcity/agent").SessionReadConfiguration> {
    return await this.archived_read(session_id, "/configuration");
  }
  async archived_interactions(session_id: string): Promise<SessionInteractionRequest[]> {
    return await this.archived_read(session_id, "/interactions");
  }
  async remove_archived(session_id: string): Promise<boolean> {
    return await this.archived_read(session_id, "", "DELETE");
  }
  private async archived_read<T>(session_id: string, suffix: string, method = "GET"): Promise<T> {
    if (this.closed) throw new Error("session_storage_lease_released");
    if (!session_id.trim()) throw new Error("session_validation_error");
    const payload = await read_http_json<{ success?: boolean; error?: string; data?: T }>(
      `${this.base_url}/api/sdk/archived-sessions/${encodeURIComponent(session_id)}${suffix}`,
      { method, headers: this.headers() },
    );
    if (!payload.success || payload.data === undefined) throw new Error(payload.error || "session_storage_read_failed");
    return payload.data;
  }

  async clean_archive(): Promise<AgentCleanArchiveResult> {
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      removed_session_ids?: string[];
    }>(`${this.base_url}/api/sdk/archived-sessions`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!payload.success) {
      throw new Error(String(payload.error || "Remote clean archive failed"));
    }
    return {
      removed_session_ids: Array.isArray(payload.removed_session_ids)
        ? payload.removed_session_ids
        : [],
    };
  }

  async run_power_action(
    input: RemoteAgentPowerActionInput,
  ): Promise<RemoteAgentPowerActionResult> {
    const payload = await read_http_action_json<RemoteAgentPowerActionResult>(
      `${this.base_url}/api/powers/action`,
      {
        method: "POST",
        headers: this.headers({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          power_name: input.power,
          action_name: input.action,
          ...(input.payload !== undefined ? { payload: input.payload } : {}),
        }),
      },
    );
    if (typeof payload.success !== "boolean") {
      throw new Error("Remote power action returned an invalid response");
    }
    return payload;
  }

  /** 当前连接绑定 Agent 的待处理交互。 */
  async list_interactions(input?: AgentListInteractionsInput): Promise<AgentInteraction[]> {
    const query = new URLSearchParams();
    const { limit } = validate_interaction_list_input(input);
    if (limit !== undefined) query.set("limit", String(limit));
    const payload = await read_http_json<{
      /** 请求成功标记。 */ success?: boolean;
      /** 静态或领域错误。 */ error?: string;
      /** canonical 交互快照。 */ interactions?: AgentInteraction[];
    }>(`${this.base_url}/api/sdk/interactions?${query}`, { headers: this.headers() });
    if (!payload.success || !Array.isArray(payload.interactions)) {
      throw new Error(payload.error || "Remote Agent interactions list failed");
    }
    return payload.interactions;
  }

  /** 复用 Session 的 NDJSON ready 握手，连接取消时同步释放读取器。 */
  async subscribe_interactions(input: RemoteInteractionSubscriptionInput): Promise<TransportSubscription> {
    const headers = this.headers();
    const abort_controller = new AbortController();
    let resolve_ready!: () => void;
    let reject_ready!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => { resolve_ready = resolve; reject_ready = reject; });
    // fetch 阶段也可能关闭 transport；先登记取消句柄。
    const close = async () => {
      this.resources.delete(close_owned);
      abort_controller.abort();
      reject_ready(new Error("Remote Agent interaction connection closed"));
    };
    const close_owned = async () => { await close(); input.on_close(new Error("Remote City connection closed")); };
    this.resources.add(close_owned);
    // fetch 失败前也必须消费 ready 的拒绝，避免关闭期间的未处理 Promise。
    void ready.catch(() => undefined);
    try {
      const response = await fetch(`${this.base_url}/api/sdk/interactions/events`, { headers, signal: abort_controller.signal });
      if (!response.ok || !response.body) throw new Error(`Remote Agent interaction events failed (${response.status})`);
      void consume_http_event_stream<AgentInteractionChange>({
        body: response.body, abort_controller,
        on_ready: resolve_ready,
        on_ready_error: reject_ready,
        on_event: input.on_event,
      }).then((error) => {
        this.resources.delete(close_owned);
        if (!abort_controller.signal.aborted) input.on_close(error);
      });
      await ready;
      if (this.closed || abort_controller.signal.aborted) throw new Error("Remote City connection closed");
      return { close };
    } catch (error) {
      this.resources.delete(close_owned);
      abort_controller.abort();
      throw error;
    }
  }

  /** 普通响应不进入私密通道。 */
  async respond_interaction(input: AgentRespondInteractionInput): Promise<SessionInteractionResult> {
    return await this.send_interaction_response("respond", input);
  }

  /** 私密响应专用入口；不读取或传播服务端的原始异常正文。 */
  async submit_private_interaction(input: AgentRespondInteractionInput): Promise<SessionInteractionResult> {
    try { return await this.send_interaction_response("submit-private", input); }
    catch { throw new Error("Private Agent interaction submission failed"); }
  }

  private async send_interaction_response(action: "respond" | "submit-private", input: AgentRespondInteractionInput): Promise<SessionInteractionResult> {
    const payload = await read_http_json<{
      /** 请求成功标记。 */ success?: boolean;
      /** 响应提交结果。 */ result?: SessionInteractionResult;
      /** 错误文本，不包含私密输入。 */ error?: string;
    }>(`${this.base_url}/api/sdk/interactions/${action}`, {
      method: "POST", headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(validate_interaction_response_input(input)),
    });
    if (!payload.success || !payload.result) throw new Error(payload.error || "Remote Agent interaction response failed");
    return payload.result;
  }

  async interactions(session_id: string, type: string): Promise<SessionInteractionRequest[]> {
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      interactions?: SessionInteractionRequest[];
    }>(this.session_url(session_id, type, "/interactions"), {
      headers: this.headers(),
    });
    if (!payload.success || !Array.isArray(payload.interactions)) {
      throw new Error(String(payload.error || "Remote session interactions failed"));
    }
    return payload.interactions;
  }

  async status(session_id: string, type: string): Promise<AgentSessionStatus> {
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      status?: AgentSessionStatus;
    }>(this.session_url(session_id, type, "/status"), {
      headers: this.headers(),
    });
    if (!payload.success || !payload.status) {
      throw new Error(String(payload.error || "Remote session status failed"));
    }
    return payload.status;
  }

  /** HTTP 只提交一次；结果未知交由调用方回读权威快照。 */
  async retry_model_step(session_id: string, type: string, input: import("@downcity/type").SessionModelRetryInput): Promise<import("@downcity/type").SessionModelRetryResult> {
    const payload = await read_http_json<SessionModelRetryHttpPayload>(
      this.session_url(session_id, type, "/retry-model-step"), {
        method: "POST", headers: this.headers({ "Content-Type": "application/json" }), body: JSON.stringify(input),
      });
    if (!payload.success || !payload.result) throw new Error(payload.error || "Remote model retry submission failed");
    return payload.result;
  }

  async set(
    session_id: string,
    type: string,
    input: RemoteSessionSetInput,
    options?: AgentSessionSetOptions,
  ): Promise<void> {
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      queued?: boolean;
    }>(this.session_url(session_id, type, "/set"), {
      method: "POST",
      headers: this.headers({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ ...input, ...(options ? { options } : {}) }),
    });
    if (payload.success !== true || payload.queued !== true) {
      throw new Error(String(payload.error || "Remote session set failed"));
    }
  }

  async respond(
    session_id: string,
    type: string,
    input: RespondSessionInteractionInput,
  ): Promise<SessionInteractionResult> {
    const payload = await read_http_json<{
      success?: boolean;
      result?: SessionInteractionResult;
      error?: string;
    }>(this.session_url(session_id, type, "/respond"), {
      method: "POST",
      headers: this.headers({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(input),
    });
    if (!payload.success || !payload.result) {
      throw new Error(String(payload.error || "Remote session interaction response failed"));
    }
    return payload.result;
  }
}

async function read_http_json<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) {
    const message = extract_error_message(payload);
    const error = new Error(message || `HTTP ${response.status}`);
    if (payload && typeof payload === "object" && "code" in payload && payload.code === "session_busy") {
      const conflict = payload as { /** 目标 Session。 */ session_id?: string; /** 目标 Turn。 */ turn_id?: string; /** 占用对象。 */ occupied_by?: import("@downcity/type").SessionPromptActor };
      Object.assign(error, { code: "session_busy", session_id: conflict.session_id, turn_id: conflict.turn_id, occupied_by: conflict.occupied_by });
    }
    throw error;
  }
  return payload;
}

async function read_http_action_json<T extends { success?: boolean }>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => ({}))) as T;
  if (!response.ok && typeof payload.success !== "boolean") {
    const message = extract_error_message(payload);
    throw new Error(message || `HTTP ${response.status}`);
  }
  return payload;
}

async function consume_http_event_stream<TEvent>(params: {
  body: ReadableStream<Uint8Array>;
  abort_controller: AbortController;
  on_ready: () => void;
  on_ready_error: (error: unknown) => void;
  /** 已解码的事件，由对应订阅入口确定类型。 */
  on_event: (event: TEvent) => void;
}): Promise<unknown | undefined> {
  const decoder = new TextDecoder();
  const reader = params.body.getReader();
  let buffered = "";
  let ready_resolved = false;
  let close_error: unknown;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      let newline_index = buffered.indexOf("\n");
      while (newline_index >= 0) {
        const line = buffered.slice(0, newline_index).trim();
        buffered = buffered.slice(newline_index + 1);
        if (line) {
          const value = JSON.parse(line) as unknown;
          if (is_sdk_events_ready_frame(value)) {
            ready_resolved = true;
            params.on_ready();
          } else {
            params.on_event(value as TEvent);
          }
        }
        newline_index = buffered.indexOf("\n");
      }
    }

    const tail = buffered.trim();
    if (tail) {
      const value = JSON.parse(tail) as unknown;
      if (is_sdk_events_ready_frame(value)) {
        ready_resolved = true;
        params.on_ready();
      } else {
        params.on_event(value as TEvent);
      }
    }

    if (!params.abort_controller.signal.aborted) {
      if (!ready_resolved) {
        const error = new Error("Remote session events connection closed before ready");
        params.on_ready_error(error);
        throw error;
      }
    }
  } catch (error) {
    close_error = error;
    if (!params.abort_controller.signal.aborted) {
      if (!ready_resolved) {
        params.on_ready_error(error);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  return close_error;
}

function extract_error_message(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  if ("error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  if ("message" in payload && typeof payload.message === "string") {
    return payload.message;
  }
  return "";
}

function is_sdk_events_ready_frame(value: unknown): value is SdkEventsReadyFrame {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as { type?: unknown }).type === "sdk-events-ready"
  );
}
