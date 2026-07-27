/**
 * RemoteSession：统一 SessionMutation 协议的远程 Session 客户端。
 *
 * 事件泵只传输一种 Mutation；审批查询、模式和决策全部绑定当前 Session。
 */

import type {
  AgentSessionConfigSnapshot,
  AgentSessionForkInput,
  AgentSessionInfo,
  AgentSessionSystemSnapshot,
} from "@/types/agent/SessionTypes.js";
import type { RemoteAgentSession } from "@/types/agent/SessionActor.js";
import type {
  RespondSessionInteractionInput,
  SessionApprovalModeSnapshot,
  SessionInteractionResult,
  SessionPendingInteraction,
  SetSessionApprovalModeInput,
} from "@/types/session/SessionInteraction.js";
import type {
  SessionMutation,
  SessionMutationSubscriber,
  SessionMutationUnsubscribe,
} from "@/types/session/SessionMutation.js";
import type {
  ListSessionMessagesInput,
  SessionMessagePage,
} from "@/types/session/SessionMessage.js";
import { is_agent_session_prompt_input_empty } from "@/types/sdk/AgentSessionPrompt.js";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type { AgentSessionStopResult } from "@/types/sdk/AgentSessionStop.js";
import type {
  AgentSessionTurnHandle,
  AgentSessionTurnResult,
} from "@/types/sdk/AgentSessionTurn.js";
import { SessionEventHub } from "@/session/runtime/SessionEventHub.js";
import type {
  RemoteSessionTransport,
  TransportSubscription,
} from "@/remote/RemoteTransport.js";

type Deferred<T> = {
  /** 当前延迟 Promise。 */
  promise: Promise<T>;
  /** 兑现当前 Promise。 */
  resolve: (value: T) => void;
};

type RemoteTurnLifecycle = {
  /** 当前 Turn 标识。 */
  turn_id: string;
  /** 当前 Turn 的最终结果；运行中为 null。 */
  result: AgentSessionTurnResult | null;
  /** 当前 Turn 完成 Promise 控制器。 */
  deferred_finished: Deferred<AgentSessionTurnResult>;
};

/** 远程 Session 客户端。 */
export class RemoteSession implements RemoteAgentSession {
  readonly id: string;
  readonly agent_id: string;
  readonly config: AgentSessionConfigSnapshot;

  private readonly transport: RemoteSessionTransport;
  private readonly event_hub: SessionEventHub;
  private readonly turns_by_id = new Map<string, RemoteTurnLifecycle>();
  private readonly completed_turn_ids: string[] = [];
  private event_pump_connect_promise: Promise<void> | null = null;
  private event_pump_running = false;
  private event_subscriber_count = 0;
  private event_subscription: TransportSubscription | null = null;

  constructor(transport: RemoteSessionTransport, info: AgentSessionInfo) {
    this.transport = transport;
    this.id = info.session_id;
    this.agent_id = info.agent_id;
    this.config = {
      ...(info.model_label ? { model_label: info.model_label } : {}),
    };
    this.event_hub = new SessionEventHub();
  }

  /** 读取当前远程 Session 详情。 */
  async get_info(): Promise<AgentSessionInfo> {
    return await this.transport.get_info(this.id);
  }

  /** 向当前远程 Session 追加 Prompt。 */
  async prompt(input: AgentSessionPromptInput): Promise<AgentSessionTurnHandle> {
    if (is_agent_session_prompt_input_empty(input)) {
      throw new Error("remote session.prompt requires a non-empty query");
    }
    await this.ensure_event_pump();
    const turn = await this.transport.prompt(this.id, input);
    return create_turn_handle(this.ensure_turn_lifecycle(turn.id));
  }

  /** 停止当前远程 Session Turn。 */
  async stop(): Promise<AgentSessionStopResult> {
    await this.ensure_event_pump();
    return await this.transport.stop(this.id);
  }

  /** 把一次显式历史压缩加入当前远程 Session 的有序输入队列。 */
  async compact(): Promise<void> {
    await this.transport.compact(this.id);
  }

  /** 订阅当前 Session 的全部未来 Mutation。 */
  subscribe(subscriber: SessionMutationSubscriber): SessionMutationUnsubscribe {
    this.event_subscriber_count += 1;
    void this.ensure_event_pump().catch((error) => {
      this.fail_pending_turns(error instanceof Error ? error.message : String(error));
    });
    const unsubscribe = this.event_hub.subscribe(subscriber);
    return () => {
      unsubscribe();
      this.event_subscriber_count = Math.max(0, this.event_subscriber_count - 1);
      void this.maybe_stop_event_pump();
    };
  }

  /** 读取远程 Message 快照。 */
  async messages(input?: ListSessionMessagesInput): Promise<SessionMessagePage> {
    return await this.transport.messages(this.id, input);
  }

  /** 读取远程 Session 的 System 快照。 */
  async system(): Promise<AgentSessionSystemSnapshot> {
    return await this.transport.system(this.id);
  }

  /** 列出当前远程 Session 正在等待用户响应的 Interaction。 */
  async interactions(): Promise<SessionPendingInteraction[]> {
    return await this.transport.interactions(this.id);
  }

  /** 读取当前远程 Session 的工具审批模式。 */
  async approval_mode(): Promise<SessionApprovalModeSnapshot> {
    return await this.transport.approval_mode(this.id);
  }

  /** 更新当前远程 Session 的工具审批模式。 */
  async set_approval_mode(input: SetSessionApprovalModeInput): Promise<SessionApprovalModeSnapshot> {
    return await this.transport.set_approval_mode(this.id, input);
  }

  /** 提交当前远程 Session 的 Interaction 用户响应。 */
  async respond(input: RespondSessionInteractionInput): Promise<SessionInteractionResult> {
    return await this.transport.respond(this.id, input);
  }

  /** 从当前远程 Session 创建分支。 */
  async fork(input?: AgentSessionForkInput | string): Promise<RemoteAgentSession> {
    return new RemoteSession(this.transport, await this.transport.fork(this.id, input));
  }

  private async ensure_event_pump(): Promise<void> {
    if (this.event_pump_connect_promise) return await this.event_pump_connect_promise;
    if (this.event_pump_running) return;
    this.event_pump_connect_promise = (async () => {
      let resolved_ready = false;
      this.event_subscription = await this.transport.subscribe({
        session_id: this.id,
        on_ready: () => {
          resolved_ready = true;
        },
        on_event: (mutation) => this.handle_mutation(mutation),
        on_close: (error) => this.handle_event_pump_closed(error),
      });
      this.event_pump_running = true;
      if (!resolved_ready) throw new Error("Remote session events connection closed before ready");
    })();
    try {
      await this.event_pump_connect_promise;
    } finally {
      this.event_pump_connect_promise = null;
    }
  }

  private handle_mutation(mutation: SessionMutation): void {
    const turn_id = "turn_id" in mutation ? mutation.turn_id : undefined;
    if (turn_id) this.ensure_turn_lifecycle(turn_id);
    if (mutation.variant === "turn" && mutation.type === "finish") {
      const lifecycle = this.ensure_turn_lifecycle(mutation.turn_id);
      const result: AgentSessionTurnResult = {
        turn_id: mutation.turn_id,
        text: mutation.text || "",
        success: mutation.status === "completed",
        ...(mutation.error ? { error: mutation.error } : {}),
      };
      lifecycle.result = result;
      lifecycle.deferred_finished.resolve(result);
      this.remember_completed_turn(mutation.turn_id);
      void this.maybe_stop_event_pump();
    }
    this.event_hub.publish(mutation);
  }

  private handle_event_pump_closed(error?: unknown): void {
    this.event_subscription = null;
    this.event_pump_running = false;
    this.fail_pending_turns(
      error instanceof Error ? error.message : String(error || "Remote session events connection closed"),
    );
  }

  private ensure_turn_lifecycle(turn_id: string): RemoteTurnLifecycle {
    const cached = this.turns_by_id.get(turn_id);
    if (cached) return cached;
    const created: RemoteTurnLifecycle = {
      turn_id,
      result: null,
      deferred_finished: create_deferred<AgentSessionTurnResult>(),
    };
    this.turns_by_id.set(turn_id, created);
    return created;
  }

  private fail_pending_turns(message: string): void {
    for (const lifecycle of this.turns_by_id.values()) {
      if (lifecycle.result) continue;
      const result: AgentSessionTurnResult = {
        turn_id: lifecycle.turn_id,
        text: "",
        success: false,
        error: message,
      };
      lifecycle.result = result;
      lifecycle.deferred_finished.resolve(result);
      this.remember_completed_turn(lifecycle.turn_id);
    }
  }

  private remember_completed_turn(turn_id: string): void {
    this.completed_turn_ids.push(turn_id);
    while (this.completed_turn_ids.length > 200) {
      const oldest_turn_id = this.completed_turn_ids.shift();
      if (oldest_turn_id) this.turns_by_id.delete(oldest_turn_id);
    }
  }

  private async maybe_stop_event_pump(): Promise<void> {
    if (this.event_subscriber_count > 0) return;
    if ([...this.turns_by_id.values()].some((item) => item.result === null)) return;
    const current = this.event_subscription;
    this.event_subscription = null;
    this.event_pump_running = false;
    if (!current) return;
    await current.close().catch((error) => {
      this.fail_pending_turns(error instanceof Error ? error.message : String(error));
    });
  }
}

function create_deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((inner_resolve) => {
    resolve = inner_resolve;
  });
  return { promise, resolve };
}

function create_turn_handle(lifecycle: RemoteTurnLifecycle): AgentSessionTurnHandle {
  return {
    id: lifecycle.turn_id,
    get result() {
      return lifecycle.result;
    },
    finished: lifecycle.deferred_finished.promise,
  };
}
