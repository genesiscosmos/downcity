/**
 * RemoteAgent RPC transport。
 *
 * 关键点（中文）
 * - 只把 RemoteAgent 的 session actor 方法映射到 RpcClient。
 * - 长连接生命周期由 RpcClient 管理。
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
  RemoteAgentPluginActionInput,
  RemoteAgentPluginActionResult,
} from "@/types/remote/RemoteAgentPluginAction.js";
import type { SessionMutation } from "@downcity/agent";
import type { AgentSessionPromptInput } from "@downcity/agent";
import type { AgentSessionStopResult } from "@downcity/agent";
import { RpcClient, parse_rpc_url } from "@/remote/transports/RpcClient.js";
import type {
  RemoteAgentTransport,
  TransportSubscription,
} from "@/remote/RemoteTransport.js";
import type {
  RespondSessionInteractionInput,
  SessionInteractionResult,
  SessionPendingInteraction,
} from "@downcity/agent";

/**
 * 本机 RPC transport。
 */
export class RpcRemoteAgentTransport implements RemoteAgentTransport {
  private readonly client: RpcClient;

  constructor(url: string) {
    this.client = new RpcClient(parse_rpc_url(url));
  }

  async create_session(input?: AgentCreateSessionInput): Promise<AgentSessionInfo> {
    return await this.client.create_session(input);
  }

  async get_info(session_id: string, origin_type: string): Promise<AgentSessionInfo> {
    return await this.client.get_session(session_id, origin_type);
  }

  async prompt(
    session_id: string,
    origin_type: string,
    input: AgentSessionPromptInput,
  ): Promise<{ id: string }> {
    return await this.client.prompt_session({
      session_id,
      origin_type,
      input,
    });
  }

  async stop(session_id: string, origin_type: string): Promise<AgentSessionStopResult> {
    return await this.client.stop_session(session_id, origin_type);
  }

  async subscribe(params: {
    session_id: string;
    origin_type: string;
    on_ready: () => void;
    on_event: (event: SessionMutation) => void;
    on_close: (error?: unknown) => void;
  }): Promise<TransportSubscription> {
    const subscription = await this.client.subscribe_session({
      session_id: params.session_id,
      origin_type: params.origin_type,
      on_ready: params.on_ready,
      on_event: params.on_event,
      on_close: params.on_close,
    });
    return {
      close: async () => {
        await subscription.unsubscribe();
      },
    };
  }

  async messages(
    session_id: string,
    origin_type: string,
    input?: ListSessionMessagesInput,
  ): Promise<SessionMessagePage> {
    return await this.client.get_session_messages({
      session_id,
      origin_type,
      input,
    });
  }

  async system(session_id: string, origin_type: string): Promise<AgentSessionSystemSnapshot> {
    return await this.client.get_session_system(session_id, origin_type);
  }

  async fork(
    session_id: string,
    origin_type: string,
    input?: AgentSessionForkInput | string,
  ): Promise<AgentSessionInfo> {
    const message_id =
      typeof input === "string"
        ? String(input || "").trim() || undefined
        : String(input?.message_id || "").trim() || undefined;
    return await this.client.fork_session({
      session_id,
      origin_type,
      ...(message_id ? { message_id } : {}),
      ...(typeof input !== "string" && input?.include_message === false ? { include_message: false } : {}),
    });
  }

  async list_sessions(input?: AgentListSessionsInput): Promise<AgentSessionSummaryPage> {
    return await this.client.list_sessions(input);
  }

  async archive_session(
    input: AgentArchiveSessionInput,
  ): Promise<AgentArchiveSessionResult> {
    return await this.client.archive_session(input);
  }

  async archive_sessions(
    input?: AgentArchiveSessionsInput,
  ): Promise<AgentArchiveSessionsResult> {
    return await this.client.archive_sessions(input);
  }

  async clean_archive(): Promise<AgentCleanArchiveResult> {
    return await this.client.clean_archive();
  }

  async run_plugin_action(
    input: RemoteAgentPluginActionInput,
  ): Promise<RemoteAgentPluginActionResult> {
    return await this.client.run_internal_plugin_action({
      plugin_name: input.plugin,
      action_name: input.action,
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
    });
  }

  async interactions(session_id: string, origin_type: string): Promise<SessionPendingInteraction[]> {
    return await this.client.get_session_interactions(session_id, origin_type);
  }

  async status(session_id: string, origin_type: string): Promise<AgentSessionStatus> {
    return await this.client.get_session_status(session_id, origin_type);
  }

  async set(
    session_id: string,
    origin_type: string,
    input: RemoteSessionSetInput,
    options?: AgentSessionSetOptions,
  ): Promise<void> {
    await this.client.set_session(session_id, origin_type, input, options);
  }

  async respond(
    session_id: string,
    origin_type: string,
    input: RespondSessionInteractionInput,
  ): Promise<SessionInteractionResult> {
    return await this.client.respond_session_interaction(session_id, origin_type, input);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
