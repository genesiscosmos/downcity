/**
 * RemoteAgent HTTP transport。
 *
 * 关键点（中文）
 * - 只适配 downcity Agent HTTP gateway 的 SDK routes。
 * - 不处理 RemoteSession 的 turn lifecycle，避免 transport 与 actor 逻辑混在一起。
 */

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
  AgentSessionSummaryPage,
  AgentSessionSystemSnapshot,
} from "@/types/agent/SessionTypes.js";
import type {
  ListSessionMessagesInput,
  SessionMessagePage,
} from "@/types/session/SessionMessage.js";
import type {
  RemoteAgentPluginActionInput,
  RemoteAgentPluginActionResult,
} from "@/types/agent/RemoteAgentPluginAction.js";
import type { SessionMutation } from "@/types/session/SessionMutation.js";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type { AgentSessionStopResult } from "@/types/sdk/AgentSessionStop.js";
import type {
  RemoteAgentTransport,
  TransportSubscription,
} from "@/remote/RemoteTransport.js";
import type {
  RespondSessionInteractionInput,
  SessionApprovalModeSnapshot,
  SessionInteractionResult,
  SessionPendingInteraction,
  SetSessionApprovalModeInput,
} from "@/types/session/SessionInteraction.js";

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

  constructor(url: string, token?: string) {
    this.base_url = url.replace(/\/+$/, "");
    this.token = String(token || "").trim();
  }

  private headers(input?: Record<string, string>): Headers {
    const headers = new Headers(input);
    if (this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }
    return headers;
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
      body: JSON.stringify({
        ...(input?.session_id ? { session_id: input.session_id } : {}),
      }),
    });
    if (!payload.success || !payload.session?.session_id) {
      throw new Error(String(payload.error || "Remote session create failed"));
    }
    return payload.session;
  }

  async get_info(session_id: string): Promise<AgentSessionInfo> {
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      session?: AgentSessionInfo;
    }>(`${this.base_url}/api/sdk/sessions/${encodeURIComponent(session_id)}`, {
      headers: this.headers(),
    });
    if (!payload.success || !payload.session?.session_id) {
      throw new Error(String(payload.error || "Remote session info failed"));
    }
    return payload.session;
  }

  async prompt(
    session_id: string,
    input: AgentSessionPromptInput,
  ): Promise<{ id: string }> {
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      turn?: {
        id?: string;
      };
    }>(`${this.base_url}/api/sdk/sessions/${encodeURIComponent(session_id)}/prompt`, {
      method: "POST",
      headers: this.headers({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        query: input.query,
      }),
    });
    const id = String(payload.turn?.id || "").trim();
    if (!payload.success || !id) {
      throw new Error(String(payload.error || "Remote session prompt failed"));
    }
    return { id };
  }

  async stop(session_id: string): Promise<AgentSessionStopResult> {
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      result?: AgentSessionStopResult;
    }>(`${this.base_url}/api/sdk/sessions/${encodeURIComponent(session_id)}/stop`, {
      method: "POST",
      headers: this.headers({
        "Content-Type": "application/json",
      }),
    });
    if (!payload.success || !payload.result) {
      throw new Error(String(payload.error || "Remote session stop failed"));
    }
    return payload.result;
  }

  async compact(session_id: string): Promise<void> {
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
    }>(`${this.base_url}/api/sdk/sessions/${encodeURIComponent(session_id)}/compact`, {
      method: "POST",
      headers: this.headers({
        "Content-Type": "application/json",
      }),
    });
    if (!payload.success) {
      throw new Error(String(payload.error || "Remote session compact failed"));
    }
  }

  async subscribe(params: {
    session_id: string;
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
      `${this.base_url}/api/sdk/sessions/${encodeURIComponent(params.session_id)}/events`,
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
    return {
      close: async () => {
        abort_controller.abort();
      },
    };
  }

  async messages(
    session_id: string,
    input?: ListSessionMessagesInput,
  ): Promise<SessionMessagePage> {
    const query = new URLSearchParams();
    if (input?.before_sequence !== undefined) {
      query.set("before_sequence", String(input.before_sequence));
    }
    if (input?.include_internal) query.set("include_internal", "true");
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      messages?: SessionMessagePage;
    }>(
      `${this.base_url}/api/sdk/sessions/${encodeURIComponent(session_id)}/messages${
        query.size > 0 ? `?${query.toString()}` : ""
      }`,
      {
        headers: this.headers(),
      },
    );
    if (!payload.success || !payload.messages || !Array.isArray(payload.messages.items)) {
      throw new Error(String(payload.error || "Remote session messages failed"));
    }
    return payload.messages;
  }

  async system(session_id: string): Promise<AgentSessionSystemSnapshot> {
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      system?: AgentSessionSystemSnapshot;
    }>(`${this.base_url}/api/sdk/sessions/${encodeURIComponent(session_id)}/system`, {
      headers: this.headers(),
    });
    if (!payload.success || !payload.system || !Array.isArray(payload.system.blocks)) {
      throw new Error(String(payload.error || "Remote session system failed"));
    }
    return payload.system;
  }

  async fork(
    session_id: string,
    input?: AgentSessionForkInput | string,
  ): Promise<AgentSessionInfo> {
    const message_id =
      typeof input === "string"
        ? String(input || "").trim() || undefined
        : String(input?.message_id || "").trim() || undefined;
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      session?: AgentSessionInfo;
    }>(`${this.base_url}/api/sdk/sessions/${encodeURIComponent(session_id)}/fork`, {
      method: "POST",
      headers: this.headers({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        ...(message_id ? { message_id: message_id } : {}),
      }),
    });
    if (!payload.success || !payload.session?.session_id) {
      throw new Error(String(payload.error || "Remote session fork failed"));
    }
    return payload.session;
  }

  async list_sessions(input?: AgentListSessionsInput): Promise<AgentSessionSummaryPage> {
    const query = new URLSearchParams();
    if (input?.limit !== undefined) query.set("limit", String(input.limit));
    if (input?.cursor) query.set("cursor", input.cursor);
    if (input?.query) query.set("query", input.query);
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      page?: AgentSessionSummaryPage;
    }>(
      `${this.base_url}/api/sdk/sessions${query.size > 0 ? `?${query.toString()}` : ""}`,
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
    }>(
      `${this.base_url}/api/sdk/sessions/${encodeURIComponent(session_id)}/archive`,
      {
        method: "POST",
        headers: this.headers({
          "Content-Type": "application/json",
        }),
      },
    );
    if (!payload.success || !payload.session_id) {
      throw new Error(String(payload.error || "Remote session archive failed"));
    }
    return {
      session_id: payload.session_id,
      archived_at:
        typeof payload.archived_at === "number" && Number.isFinite(payload.archived_at)
          ? payload.archived_at
          : Date.now(),
    };
  }

  async archive_sessions(
    input?: AgentArchiveSessionsInput,
  ): Promise<AgentArchiveSessionsResult> {
    const query = new URLSearchParams();
    if (input?.limit !== undefined) query.set("limit", String(input.limit));
    if (input?.cursor) query.set("cursor", input.cursor);
    if (input?.query) query.set("query", input.query);
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      page?: AgentArchiveSessionsResult;
    }>(
      `${this.base_url}/api/sdk/archived-sessions${query.size > 0 ? `?${query.toString()}` : ""}`,
      {
        headers: this.headers(),
      },
    );
    if (!payload.success || !payload.page) {
      throw new Error(String(payload.error || "Remote archived sessions list failed"));
    }
    return payload.page;
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

  async run_plugin_action(
    input: RemoteAgentPluginActionInput,
  ): Promise<RemoteAgentPluginActionResult> {
    const payload = await read_http_action_json<RemoteAgentPluginActionResult>(
      `${this.base_url}/api/plugins/action`,
      {
        method: "POST",
        headers: this.headers({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          plugin_name: input.plugin,
          action_name: input.action,
          ...(input.payload !== undefined ? { payload: input.payload } : {}),
        }),
      },
    );
    if (typeof payload.success !== "boolean") {
      throw new Error("Remote plugin action returned an invalid response");
    }
    return payload;
  }

  async interactions(session_id: string): Promise<SessionPendingInteraction[]> {
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      interactions?: SessionPendingInteraction[];
    }>(`${this.base_url}/api/sdk/sessions/${encodeURIComponent(session_id)}/interactions`, {
      headers: this.headers(),
    });
    if (!payload.success || !Array.isArray(payload.interactions)) {
      throw new Error(String(payload.error || "Remote session interactions failed"));
    }
    return payload.interactions;
  }

  async approval_mode(session_id: string): Promise<SessionApprovalModeSnapshot> {
    const payload = await read_http_json<{
      success?: boolean;
      error?: string;
      session_id?: string;
      mode?: SessionApprovalModeSnapshot["mode"];
    }>(`${this.base_url}/api/sdk/sessions/${encodeURIComponent(session_id)}/approval-mode`, {
      headers: this.headers(),
    });
    if (!payload.success || !payload.session_id || !payload.mode) {
      throw new Error(String(payload.error || "Remote shell approval mode failed"));
    }
    return {
      session_id: payload.session_id,
      mode: payload.mode,
    };
  }

  async set_approval_mode(
    session_id: string,
    input: SetSessionApprovalModeInput,
  ): Promise<SessionApprovalModeSnapshot> {
    const payload = await read_http_json<SessionApprovalModeSnapshot & {
      success?: boolean;
      error?: string;
    }>(`${this.base_url}/api/sdk/sessions/${encodeURIComponent(session_id)}/approval-mode`, {
      method: "POST",
      headers: this.headers({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ mode: input.mode }),
    });
    if (payload.success !== true) {
      throw new Error(String(payload.error || "Remote shell approval mode update failed"));
    }
    return payload;
  }

  async respond(
    session_id: string,
    input: RespondSessionInteractionInput,
  ): Promise<SessionInteractionResult> {
    const payload = await read_http_json<{
      success?: boolean;
      result?: SessionInteractionResult;
      error?: string;
    }>(`${this.base_url}/api/sdk/sessions/${encodeURIComponent(session_id)}/respond`, {
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
    throw new Error(message || `HTTP ${response.status}`);
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

async function consume_http_event_stream(params: {
  body: ReadableStream<Uint8Array>;
  abort_controller: AbortController;
  on_ready: () => void;
  on_ready_error: (error: unknown) => void;
  on_event: (event: SessionMutation) => void;
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
            params.on_event(value as SessionMutation);
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
        params.on_event(value as SessionMutation);
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
