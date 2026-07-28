/**
 * RemoteAgent 本机 RPC Client。
 *
 * 职责说明（中文）
 * - 为 `RemoteAgent(rpc://...)` 提供最小客户端实现。
 * - 复用逐行 JSON（NDJSON）协议，与本机 RPC Server 对接。
 * - 当前只承载 Session actor 所需方法。
 */

import net from "node:net";
import type {
  AgentCreateSessionInput,
  AgentListSessionsInput,
  AgentArchiveSessionInput,
  AgentArchiveSessionsInput,
  AgentArchiveSessionResult,
  AgentArchiveSessionsResult,
  AgentCleanArchiveResult,
  AgentSessionInfo,
  AgentSessionStatus,
  AgentSessionSummaryPage,
  AgentSessionSystemSnapshot,
  RemoteSessionSetInput,
} from "@/types/agent/SessionTypes.js";
import type {
  ListSessionMessagesInput,
  SessionMessagePage,
} from "@/types/session/SessionMessage.js";
import type { JsonValue } from "@/types/common/Json.js";
import type { JsonObject } from "@/types/common/Json.js";
import type { AgentSessionStopResult } from "@/types/sdk/AgentSessionStop.js";
import type {
  PluginActionResult,
} from "@/types/plugin/PluginAction.js";
import type { PluginAvailability, PluginView } from "@/types/plugin/PluginRuntime.js";
import type { PluginSnapshot } from "@/types/plugin/PluginState.js";
import type { SessionMutation } from "@/types/session/SessionMutation.js";
import type {
  RespondSessionInteractionInput,
  SessionInteractionResult,
  SessionPendingInteraction,
} from "@/types/session/SessionInteraction.js";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type {
  RpcClientEndpoint,
  RpcClientFrame,
  RpcInternalStatus,
  RpcRequest,
  RpcSessionSubscription,
  RpcSystemPromptPayload,
} from "@/types/rpc/RpcProtocol.js";

export type {
  RpcClientEndpoint,
  RpcSessionSubscription,
  RpcSystemPromptPayload,
} from "@/types/rpc/RpcProtocol.js";

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: unknown) => void;
};

type RpcSubscription = {
  on_ready: () => void;
  on_event: (event: SessionMutation) => void;
  /** 底层 RPC 连接结束后的通知。 */
  on_close: (error?: unknown) => void;
};

/**
 * RPC Client。
 */
export class RpcClient {
  private readonly endpoint: RpcClientEndpoint;
  private socket: net.Socket | null = null;
  private connect_promise: Promise<void> | null = null;
  private buffered = "";
  private readonly pending_requests = new Map<string, PendingRequest>();
  private readonly subscriptions = new Map<string, RpcSubscription>();
  private request_sequence = 0;

  constructor(endpoint: RpcClientEndpoint) {
    this.endpoint = endpoint;
  }

  /**
   * 列出远程 session。
   */
  async list_sessions(
    input?: AgentListSessionsInput,
  ): Promise<AgentSessionSummaryPage> {
    const data = await this.request<{ page: AgentSessionSummaryPage }>({
      method: "sdk.sessions.list",
      params: input,
    });
    return data.page;
  }

  /**
   * 创建远程 session。
   */
  async create_session(
    input?: AgentCreateSessionInput,
  ): Promise<AgentSessionInfo> {
    const data = await this.request<{ session: AgentSessionInfo }>({
      method: "sdk.sessions.create",
      params: input,
    });
    return data.session;
  }

  /**
   * 归档远程 session。
   */
  async archive_session(
    input: AgentArchiveSessionInput,
  ): Promise<AgentArchiveSessionResult> {
    const data = await this.request<{ result: AgentArchiveSessionResult }>({
      method: "sdk.sessions.archive",
      params: {
        session_id: input.id,
      },
    });
    return data.result;
  }

  /**
   * 列出远程已归档 session。
   */
  async archive_sessions(
    input?: AgentArchiveSessionsInput,
  ): Promise<AgentArchiveSessionsResult> {
    const data = await this.request<{ page: AgentArchiveSessionsResult }>({
      method: "sdk.sessions.archived.list",
      params: input,
    });
    return data.page;
  }

  /**
   * 清空远程已归档 session。
   */
  async clean_archive(): Promise<AgentCleanArchiveResult> {
    const data = await this.request<{ removed_session_ids: string[] }>({
      method: "sdk.sessions.archived.clean",
    });
    return {
      removed_session_ids: Array.isArray(data.removed_session_ids)
        ? data.removed_session_ids
        : [],
    };
  }

  /**
   * 获取远程 session 信息。
   */
  async get_session(session_id: string): Promise<AgentSessionInfo> {
    const data = await this.request<{ session: AgentSessionInfo }>({
      method: "sdk.sessions.get",
      params: {
        session_id: session_id,
      },
    });
    return data.session;
  }

  /**
   * 发送 prompt。
   */
  async prompt_session(params: {
    session_id: string;
    input: AgentSessionPromptInput;
  }): Promise<{ id: string }> {
    const data = await this.request<{ turn: { id: string } }>({
      method: "sdk.sessions.prompt",
      params: {
        session_id: params.session_id,
        input: params.input,
      },
    });
    return data.turn;
  }

  /**
   * 停止远程 session 当前 turn。
   */
  async stop_session(session_id: string): Promise<AgentSessionStopResult> {
    const data = await this.request<{ result: AgentSessionStopResult }>({
      method: "sdk.sessions.stop",
      params: {
        session_id: session_id,
      },
    });
    return data.result;
  }

  /**
   * 把一次显式历史压缩加入远程 Session 的有序输入队列。
   */
  async compact_session(session_id: string): Promise<{ id: string }> {
    const data = await this.request<{ compact: { id: string } }>({
      method: "sdk.sessions.compact",
      params: {
        session_id: session_id,
      },
    });
    return data.compact;
  }

  /**
   * 读取 session records。
   */
  async get_session_messages(params: {
    session_id: string;
    input?: ListSessionMessagesInput;
  }): Promise<SessionMessagePage> {
    const data = await this.request<{ messages: SessionMessagePage }>({
      method: "sdk.sessions.messages",
      params: {
        session_id: params.session_id,
        input: params.input,
      },
    });
    return data.messages;
  }

  /**
   * 读取 system snapshot。
   */
  async get_session_system(session_id: string): Promise<AgentSessionSystemSnapshot> {
    const data = await this.request<{ system: AgentSessionSystemSnapshot }>({
      method: "sdk.sessions.system",
      params: {
        session_id: session_id,
      },
    });
    return data.system;
  }

  async get_session_interactions(session_id: string): Promise<SessionPendingInteraction[]> {
    const data = await this.request<{ interactions: SessionPendingInteraction[] }>({
      method: "sdk.sessions.interactions",
      params: { session_id: session_id },
    });
    return data.interactions;
  }

  async get_session_status(session_id: string): Promise<AgentSessionStatus> {
    const data = await this.request<{ status: AgentSessionStatus }>({
      method: "sdk.sessions.status",
      params: { session_id: session_id },
    });
    return data.status;
  }

  async set_session(
    session_id: string,
    input: RemoteSessionSetInput,
  ): Promise<void> {
    await this.request<{ queued: true }>({
      method: "sdk.sessions.set",
      params: { session_id: session_id, input },
    });
  }

  async respond_session_interaction(
    session_id: string,
    input: RespondSessionInteractionInput,
  ): Promise<SessionInteractionResult> {
    const data = await this.request<{ result: SessionInteractionResult }>({
      method: "sdk.sessions.respond",
      params: { session_id: session_id, input },
    });
    return data.result;
  }

  /**
   * 分叉 session。
   */
  async fork_session(params: {
    session_id: string;
    message_id?: string;
  }): Promise<AgentSessionInfo> {
    const data = await this.request<{ session: AgentSessionInfo }>({
      method: "sdk.sessions.fork",
      params: {
        session_id: params.session_id,
        ...(params.message_id ? { message_id: params.message_id } : {}),
      },
    });
    return data.session;
  }

  /**
   * 订阅 session 事件。
   */
  async subscribe_session(params: {
    session_id: string;
    on_ready: () => void;
    on_event: (event: SessionMutation) => void;
    on_close: (error?: unknown) => void;
  }): Promise<RpcSessionSubscription> {
    const data = await this.request<{ subscription_id: string }>({
      method: "sdk.sessions.subscribe",
      params: {
        session_id: params.session_id,
      },
    });
    const subscription_id = String(data.subscription_id || "").trim();
    if (!subscription_id) {
      throw new Error("RPC subscription did not return subscription_id");
    }
    this.subscriptions.set(subscription_id, {
      on_ready: params.on_ready,
      on_event: params.on_event,
      on_close: params.on_close,
    });
    params.on_ready();
    return {
      subscription_id,
      unsubscribe: async () => {
        this.subscriptions.delete(subscription_id);
        await this.request({
          method: "sdk.sessions.unsubscribe",
          params: {
            subscription_id: subscription_id,
          },
        });
      },
    };
  }

  /**
   * 读取 Agent 内部状态。
   */
  async get_internal_status(): Promise<RpcInternalStatus> {
    return await this.request<RpcInternalStatus>({
      method: "internal.status.get",
    });
  }

  /**
   * 清空 Agent runtime 内指定 session 的消息。
   */
  async clear_internal_session_messages(
    session_id: string,
  ): Promise<{ session_id: string; cleared: boolean }> {
    return await this.request<{ session_id: string; cleared: boolean }>({
      method: "internal.sessions.clear_messages",
      params: {
        session_id: session_id,
      },
    });
  }

  /**
   * 清空 Agent runtime 内指定 session 的 chat history。
   */
  async clear_internal_chat_history(
    session_id: string,
  ): Promise<{ session_id: string; cleared: boolean }> {
    return await this.request<{ session_id: string; cleared: boolean }>({
      method: "internal.sessions.clear_chat_history",
      params: {
        session_id: session_id,
      },
    });
  }

  /**
   * 解析 Agent runtime 内指定 session 的 system prompt。
   */
  async resolve_internal_system_prompt(
    session_id: string,
  ): Promise<RpcSystemPromptPayload> {
    return await this.request<RpcSystemPromptPayload>({
      method: "internal.sessions.resolve_system_prompt",
      params: {
        session_id: session_id,
      },
    });
  }

  /**
   * 列出 Agent runtime 注册的 plugin catalog。
   */
  async list_internal_plugin_catalog(): Promise<PluginView[]> {
    const data = await this.request<{ plugins: PluginView[] }>({
      method: "internal.plugins.catalog",
    });
    return Array.isArray(data.plugins) ? data.plugins : [];
  }

  /**
   * 列出 Agent runtime 内 plugin 状态。
   */
  async list_internal_plugin_states(): Promise<PluginSnapshot[]> {
    const data = await this.request<{ plugins: PluginSnapshot[] }>({
      method: "internal.plugins.list",
    });
    return Array.isArray(data.plugins) ? data.plugins : [];
  }

  /**
   * 检查 Agent runtime 内 plugin 可用性。
   */
  async get_internal_plugin_availability(
    plugin_name: string,
  ): Promise<PluginAvailability> {
    const data = await this.request<{
      availability: PluginAvailability;
    }>({
      method: "internal.plugins.availability",
      params: {
        plugin_name: plugin_name,
      },
    });
    return data.availability;
  }

  /**
   * 执行 Agent runtime 内 plugin action。
   */
  async run_internal_plugin_action(params: {
    plugin_name: string;
    action_name: string;
    payload?: JsonValue;
  }): Promise<PluginActionResult<JsonValue> & {
    plugin_name?: string;
    action_name?: string;
  }> {
    return await this.request<PluginActionResult<JsonValue> & {
      plugin_name?: string;
      action_name?: string;
    }>({
      method: "internal.plugins.action",
      params: {
        plugin_name: params.plugin_name,
        action_name: params.action_name,
        ...(params.payload !== undefined ? { payload: params.payload } : {}),
      },
    });
  }

  /**
   * 关闭底层连接。
   */
  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    this.connect_promise = null;
    this.buffered = "";
    for (const pending of this.pending_requests.values()) {
      pending.reject(new Error("RPC client closed"));
    }
    this.pending_requests.clear();
    this.fail_all_subscriptions("RPC client closed");
    if (!socket) return;
    await new Promise<void>((resolve) => {
      socket.end(() => resolve());
    });
  }

  private async request<TData = unknown>(input: {
    method: RpcRequest["method"];
    params?: unknown;
  }): Promise<TData> {
    await this.ensure_connected();
    const socket = this.socket;
    if (!socket) {
      throw new Error("RPC socket is not connected");
    }
    const id = `rpc_${Date.now()}_${this.request_sequence += 1}`;
    const request = (
      input.params === undefined
        ? {
            id,
            method: input.method,
          }
        : {
            id,
            method: input.method,
            params: input.params as never,
          }
    ) as RpcRequest;
    const result = await new Promise<TData>((resolve, reject) => {
      this.pending_requests.set(id, { resolve, reject });
      socket.write(`${JSON.stringify(request)}\n`, (error) => {
        if (!error) return;
        this.pending_requests.delete(id);
        reject(error);
      });
    });
    return result;
  }

  private async ensure_connected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connect_promise) {
      await this.connect_promise;
      return;
    }

    this.connect_promise = new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({
        host: this.endpoint.host,
        port: this.endpoint.port,
      });

      socket.setEncoding("utf8");

      socket.on("connect", () => {
        this.socket = socket;
        resolve();
      });

      socket.on("data", (chunk: string) => {
        this.consume_data(chunk);
      });

      socket.on("error", (error) => {
        if (!this.socket) {
          reject(error);
          return;
        }
        this.fail_all_pending(error);
        this.fail_all_subscriptions(
          error instanceof Error ? error.message : String(error),
        );
      });

      socket.on("close", () => {
        this.socket = null;
        this.connect_promise = null;
        this.fail_all_pending(new Error("RPC socket closed"));
        this.fail_all_subscriptions("RPC socket closed");
      });
    });

    try {
      await this.connect_promise;
    } catch (error) {
      this.connect_promise = null;
      throw error;
    }
  }

  private consume_data(chunk: string): void {
    this.buffered += chunk;
    let newline_index = this.buffered.indexOf("\n");
    while (newline_index >= 0) {
      const line = this.buffered.slice(0, newline_index).trim();
      this.buffered = this.buffered.slice(newline_index + 1);
      if (line) {
        this.consume_line(line);
      }
      newline_index = this.buffered.indexOf("\n");
    }
  }

  private consume_line(line: string): void {
    const payload = JSON.parse(line) as RpcClientFrame;
    if ("type" in payload && payload.type === "ready") {
      const subscription = this.subscriptions.get(payload.subscription_id);
      subscription?.on_ready();
      return;
    }
    if ("type" in payload && payload.type === "event") {
      const subscription = this.subscriptions.get(payload.subscription_id);
      subscription?.on_event(payload.event);
      return;
    }
    const pending = this.pending_requests.get(payload.id);
    if (!pending) return;
    this.pending_requests.delete(payload.id);
    if (payload.success) {
      pending.resolve(payload.data);
      return;
    }
    pending.reject(new Error(String(payload.error || "RPC request failed")));
  }

  private fail_all_pending(error: unknown): void {
    for (const pending of this.pending_requests.values()) {
      pending.reject(error);
    }
    this.pending_requests.clear();
  }

  private fail_all_subscriptions(message: string): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.on_close(new Error(message));
    }
    this.subscriptions.clear();
  }
}

/**
 * 解析 rpc url。
 */
export function parse_rpc_url(url_input: string): RpcClientEndpoint {
  const url = new URL(url_input);
  if (url.protocol !== "rpc:") {
    throw new Error(`Unsupported RPC protocol: ${url.protocol}`);
  }
  const host = String(url.hostname || "").trim();
  const port = Number.parseInt(String(url.port || ""), 10);
  if (!host) {
    throw new Error("RPC url requires a host");
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("RPC url requires a valid port");
  }
  return {
    host,
    port,
  };
}
