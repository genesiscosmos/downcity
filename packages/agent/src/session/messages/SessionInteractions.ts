/**
 * Session 用户异步交互运行时。
 *
 * 本模块只拥有 pending waiter、超时与恢复执行；Interaction 的权威状态由
 * SessionMessages 持久化。任何终态都必须先提交 canonical Message，再兑现等待 Promise。
 */

import type { SessionMessages } from "@/session/messages/SessionMessages.js";
import type {
  RespondSessionInteractionInput,
  SessionInteractionHandle,
  SessionInteractionLifecycle,
  SessionInteractionPort,
  SessionInteractionRequest,
  SessionInteractionResponse,
  SessionInteractionResult,
} from "@downcity/type";
import type { SessionPendingInteractionRuntime } from "@/types/session/SessionInteractions.js";

/** 单个 Session 的异步用户交互入口。 */
export class SessionInteractions implements SessionInteractionPort, SessionInteractionLifecycle {
  private readonly session_id: string;
  private readonly messages: SessionMessages;
  private readonly pending_by_id = new Map<
    string,
    SessionPendingInteractionRuntime
  >();

  constructor(options: {
    /** 当前 Interaction 运行时所属 Session 标识。 */
    session_id: string;
    /** 当前 Session 的 canonical Message 入口。 */
    messages: SessionMessages;
  }) {
    this.session_id = String(options.session_id || "").trim();
    this.messages = options.messages;
    if (!this.session_id) {
      throw new Error("SessionInteractions requires a non-empty session_id");
    }
  }

  /** 创建并持久化一次 Interaction，返回等待终态结果的句柄。 */
  async request(
    request: SessionInteractionRequest,
  ): Promise<SessionInteractionHandle> {
    this.validate_request(request);
    if (this.pending_by_id.has(request.interaction_id)) {
      throw new Error(`Session Interaction is already pending: ${request.interaction_id}`);
    }

    let resolve_result!: (result: SessionInteractionResult) => void;
    const result = new Promise<SessionInteractionResult>((resolve) => {
      resolve_result = resolve;
    });
    const pending: SessionPendingInteractionRuntime = {
      request: structuredClone(request),
      resolve: resolve_result,
    };
    this.pending_by_id.set(request.interaction_id, pending);

    try {
      await this.messages.request_interaction(request);
    } catch (error) {
      this.pending_by_id.delete(request.interaction_id);
      throw error;
    }

    return {
      interaction_id: request.interaction_id,
      result,
    };
  }

  /** 返回当前 Session 全部 pending Interaction 请求快照。 */
  list(): SessionInteractionRequest[] {
    return this.messages.list_pending_interactions().map((interaction) => interaction.request);
  }

  /** 保存用户响应，并在提交成功后恢复原执行。 */
  async respond(
    input: RespondSessionInteractionInput,
  ): Promise<SessionInteractionResult> {
    const pending = this.require_pending(input.interaction_id);
    this.validate_response(pending.request, input.response);
    await this.messages.resolve_interaction(
      input.interaction_id,
      input.response,
    );
    const result: SessionInteractionResult = input.response.outcome === "denied"
      ? {
        status: "denied",
        interaction_id: input.interaction_id,
        reason: extract_interaction_reason(input.response.payload),
      }
      : {
        status: "resolved",
        interaction_id: input.interaction_id,
        response: structuredClone(input.response),
      };
    this.finish_pending(input.interaction_id, result);
    return result;
  }

  /** 取消当前 Session 的全部 pending Interaction。 */
  async cancel_all(
    reason: "turn_stopped" | "session_disposed" | "runtime_interrupted",
  ): Promise<void> {
    let first_error: unknown;
    for (const interaction_id of [...this.pending_by_id.keys()]) {
      const result: SessionInteractionResult = {
        status: "cancelled",
        interaction_id,
        reason,
      };
      try {
        await this.messages.close_interaction(interaction_id, { reason });
        this.finish_pending(interaction_id, result);
      } catch (error) {
        first_error ??= error;
      }
    }
    if (first_error) throw first_error;
  }

  /**
   * 校验执行面提交的 Interaction 信封。
   *
   * 核心不认识业务类型：`payload` 的类型就是 `JsonValue`，怎么解释由它的生产者负责。
   * 因此这里只检查信封自身，不拆业务字段。
   */
  private validate_request(request: SessionInteractionRequest): void {
    if (!String(request.interaction_id || "").trim()) {
      throw new Error("Session Interaction requires interaction_id");
    }
    if (!String(request.turn_id || "").trim()) {
      throw new Error("Session Interaction requires turn_id");
    }
    if (!String(request.type || "").trim()) {
      throw new Error("Session Interaction requires a non-empty type");
    }
    if (!request.source || typeof request.source !== "object") {
      throw new Error("Session Interaction requires a source");
    }
    if (!String(request.source.tool_call_id || "").trim()) {
      throw new Error("Session Interaction requires the Tool Call it belongs to");
    }
  }

  /** 校验响应信封：type 必须与请求一致，outcome 必须合法。 */
  private validate_response(
    request: SessionInteractionRequest,
    response: SessionInteractionResponse,
  ): void {
    if (request.type !== response.type) {
      throw new Error("Session Interaction response type mismatch");
    }
    if (response.outcome !== "resolved" && response.outcome !== "denied") {
      throw new Error("Session Interaction response requires a valid outcome");
    }
  }

  /** 读取当前 pending Interaction 运行态。 */
  private require_pending(
    interaction_id: string,
  ): SessionPendingInteractionRuntime {
    const pending = this.pending_by_id.get(interaction_id);
    if (pending) return pending;
    throw new Error(`Pending Session Interaction not found: ${interaction_id}`);
  }

  /** 清理运行态并兑现执行方等待 Promise。 */
  private finish_pending(
    interaction_id: string,
    result: SessionInteractionResult,
  ): void {
    const pending = this.pending_by_id.get(interaction_id);
    if (!pending) return;
    this.pending_by_id.delete(interaction_id);
    pending.resolve(result);
  }
}

/** 从通用响应 payload 中读取可选的人类可读拒绝原因。 */
function extract_interaction_reason(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const reason = (payload as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : undefined;
}
