/**
 * Session 用户异步交互运行时。
 *
 * 本模块只拥有 pending waiter、超时与恢复执行；Interaction 的权威状态由
 * SessionMessages 持久化。任何终态都必须先提交 canonical Message，再兑现等待 Promise。
 */

import type { SessionMessages } from "@/session/SessionMessages.js";
import type {
  RespondSessionInteractionInput,
  SessionInteractionHandle,
  SessionInteractionLifecycle,
  SessionInteractionPort,
  SessionInteractionRequest,
  SessionInteractionResponse,
  SessionInteractionResult,
  SessionPendingInteraction,
} from "@/types/session/SessionInteraction.js";
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

    if (request.expires_at !== undefined) {
      const delay_ms = Math.max(0, request.expires_at - Date.now());
      const timer = setTimeout(() => {
        void this.expire(request.interaction_id);
      }, delay_ms);
      if (typeof timer.unref === "function") timer.unref();
      pending.timer = timer;
    }

    return {
      interaction_id: request.interaction_id,
      result,
    };
  }

  /** 返回当前 Session 全部 pending Interaction 请求快照。 */
  list(): SessionPendingInteraction[] {
    return this.messages.list_pending_interactions().map((interaction) => ({
      request: structuredClone(interaction.request),
    }));
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
    const denied = input.response.type === "approval" &&
      input.response.payload &&
      typeof input.response.payload === "object" &&
      !Array.isArray(input.response.payload) &&
      (input.response.payload as { decision?: unknown }).decision === "denied";
    const result: SessionInteractionResult = denied
      ? {
        status: "denied",
        interaction_id: input.interaction_id,
        reason: (input.response.payload as { reason?: string }).reason,
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
        await this.messages.close_interaction(interaction_id, {
          status: "cancelled",
          reason,
        });
        this.finish_pending(interaction_id, result);
      } catch (error) {
        first_error ??= error;
      }
    }
    if (first_error) throw first_error;
  }

  /** 处理单个 Interaction 自动过期。 */
  private async expire(interaction_id: string): Promise<void> {
    if (!this.pending_by_id.has(interaction_id)) return;
    const result: SessionInteractionResult = {
      status: "expired",
      interaction_id,
    };
    try {
      await this.messages.close_interaction(interaction_id, {
        status: "expired",
      });
    } catch {
      return;
    }
    this.finish_pending(interaction_id, result);
  }

  /** 校验执行面提交的 Interaction 请求。 */
  private validate_request(request: SessionInteractionRequest): void {
    if (!String(request.interaction_id || "").trim()) {
      throw new Error("Session Interaction requires interaction_id");
    }
    if (!String(request.turn_id || "").trim()) {
      throw new Error("Session Interaction requires turn_id");
    }
    if (
      request.expires_at !== undefined &&
      (!Number.isFinite(request.expires_at) || request.expires_at < request.created_at)
    ) {
      throw new Error("Session Interaction expires_at must not precede created_at");
    }
    if (!String(request.type || "").trim()) {
      throw new Error("Session Interaction requires a non-empty type");
    }
    if (request.type === "question") {
      const payload = request.payload as { questions?: unknown };
      const questions = payload?.questions;
      if (!Array.isArray(questions) || questions.length === 0) {
        throw new Error("Question Interaction requires at least one question");
      }
      const question_ids = new Set<string>();
      for (const question of questions as Array<Record<string, unknown>>) {
        if (!String(question.question_id || "").trim()) {
          throw new Error("Interaction question requires question_id");
        }
        if (question_ids.has(String(question.question_id))) {
          throw new Error("Duplicate Interaction question_id");
        }
        question_ids.add(String(question.question_id));
        if (!String(question.prompt || "").trim()) {
          throw new Error(
            `Interaction question requires prompt: ${question.question_id}`,
          );
        }
        if (
          question.response_type !== "text" &&
          (!Array.isArray(question.options) || question.options.length === 0)
        ) {
          throw new Error(
            `Select Interaction question requires options: ${question.question_id}`,
          );
        }
        if (question.options) {
          const option_values = new Set<string>();
          for (const option of question.options as Array<Record<string, unknown>>) {
            if (!String(option.value || "").trim()) {
              throw new Error(
                `Interaction option requires value: ${question.question_id}`,
              );
            }
            const option_value = String(option.value);
            if (option_values.has(option_value)) {
              throw new Error("Duplicate Interaction option value");
            }
            option_values.add(option_value);
          }
        }
      }
    }
  }

  /** 校验响应 type、问题集合与回答值。 */
  private validate_response(
    request: SessionInteractionRequest,
    response: SessionInteractionResponse,
  ): void {
    if (request.type !== response.type) {
      throw new Error("Session Interaction response type mismatch");
    }
    if (request.type !== "question") return;
    const request_payload = request.payload as { questions?: unknown };
    const response_payload = response.payload as { answers?: unknown };
    const questions = Array.isArray(request_payload.questions)
      ? request_payload.questions as Array<Record<string, unknown>>
      : [];
    const response_answers = Array.isArray(response_payload?.answers)
      ? response_payload.answers as Array<Record<string, unknown>>
      : [];
    const answers = new Map<string, string | string[]>();
    for (const answer of response_answers) {
      const question_id = String(answer.question_id || "");
      if (answers.has(question_id)) {
        throw new Error("Duplicate Session Interaction answer");
      }
      answers.set(question_id, answer.value as string | string[]);
    }
    if (answers.size !== questions.length) {
      throw new Error("Session Interaction answer count mismatch");
    }
    for (const question of questions) {
      const question_id = String(question.question_id || "");
      const value = answers.get(question_id);
      if (value === undefined) {
        throw new Error("Session Interaction answer is missing");
      }
      if (question.response_type === "multi_select") {
        if (!Array.isArray(value)) {
          throw new Error("Session Interaction answer must be an array");
        }
      } else if (typeof value !== "string") {
        throw new Error("Session Interaction answer must be a string");
      }
      if (question.response_type !== "text") {
        const allowed = new Set(
          (Array.isArray(question.options) ? question.options : []).map(
            (option) => (option as { value: string }).value,
          ),
        );
        const selected = Array.isArray(value) ? value : [value];
        if (selected.some((item) => !allowed.has(item))) {
          throw new Error("Session Interaction answer contains an invalid option");
        }
      }
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
    if (pending.timer) clearTimeout(pending.timer);
    this.pending_by_id.delete(interaction_id);
    pending.resolve(result);
  }
}
