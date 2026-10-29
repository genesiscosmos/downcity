/**
 * Session 用户异步交互运行时。
 *
 * 关键点（中文）
 * - 本模块只拥有 pending waiter 与恢复执行；Interaction 的权威状态由 SessionMessages 持久化。
 *   任何终态都必须先提交 canonical Message，再兑现等待 Promise。
 * - 通用原语只处理信封；私密 question 的受信提交委托专用解释器，明文不进入消息。
 * - 审批的专用入口（模式判断与决定解释）由 {@link ApprovalInteraction} 承担。
 *
 * Interaction 没有超时：它只能由用户响应，或随所属 Turn/Session 结束而被取消。
 */

import type { SessionMessages } from "@/session/messages/SessionMessages.js";
import { ApprovalInteraction } from "@/session/messages/ApprovalInteraction.js";
import type {
  JsonValue,
  RespondSessionInteractionInput,
  SessionApprovalMode,
  SessionInteractionHandle,
  SessionInteractionLifecycle,
  SessionInteractionPort,
  SessionInteractionRequest,
  SessionInteractionRequestInput,
  SessionInteractionResponse,
  SessionInteractionResult,
  SessionQuestionResponsePayload,
} from "@downcity/type";
import type { SessionPendingInteractionRuntime } from "@/types/session/SessionInteractions.js";
import { generate_id } from "@/utils/Id.js";
import { SessionSecrets } from "./SessionSecrets.js";
import { interaction_questions, prepare_private_question_response, validate_private_questions } from "./PrivateQuestionResponse.js";

/** 单个 Session 的异步用户交互入口。 */
export class SessionInteractions implements SessionInteractionPort, SessionInteractionLifecycle {
  /** 审批专用入口；长生命周期，每次调用只传身份与 payload。 */
  readonly approval: ApprovalInteraction;
  private readonly session_id: string;
  private readonly messages: SessionMessages;
  private readonly pending_by_id = new Map<
    string,
    SessionPendingInteractionRuntime
  >();
  /** 当前 Session 的私密变量；只存在运行时内存，不进入 canonical Message。 */
  private secrets = new SessionSecrets();
  /** 提交与取消共用队列，防止两个响应同时改变同一 pending 交互。 */
  private mutation_chain: Promise<unknown> = Promise.resolve();
  /** 受信提交完成后的安全回执，允许网络重试但不再读取已提交明文。 */
  private readonly private_receipts = new Map<string, SessionInteractionResult>();

  constructor(options: {
    /** 当前 Interaction 运行时所属 Session 标识。 */
    session_id: string;
    /** 当前 Session 的 canonical Message 入口。 */
    messages: SessionMessages;
    /** 读取当前 Session 审批模式；always-allow 在审批入口内生效。 */
    read_approval_mode?: () => SessionApprovalMode;
  }) {
    this.session_id = String(options.session_id || "").trim();
    this.messages = options.messages;
    if (!this.session_id) {
      throw new Error("SessionInteractions requires a non-empty session_id");
    }
    this.approval = new ApprovalInteraction({
      interactions: this,
      read_mode: options.read_approval_mode ?? (() => "ask"),
    });
  }

  /**
   * 创建并持久化一次 Interaction，返回等待终态结果的句柄。
   *
   * 关键点（中文）
   * - 调用方只提供语义字段；`interaction_id`、`created_at` 与 `source` 在这里补齐。
   */
  async request(
    input: SessionInteractionRequestInput,
  ): Promise<SessionInteractionHandle> {
    const request: SessionInteractionRequest = {
      interaction_id: `interaction:${generate_id()}`,
      turn_id: input.turn_id,
      type: input.type,
      source: {
        type: input.source_type ?? "tool",
        tool_call_id: input.tool_call_id,
        ...(input.tool_name ? { tool_name: input.tool_name } : {}),
      },
      ...(input.title ? { title: input.title } : {}),
      ...(input.description ? { description: input.description } : {}),
      payload: input.payload,
      ...(input.response_schema ? { response_schema: input.response_schema } : {}),
      created_at: Date.now(),
    };
    this.validate_request(request);
    validate_private_questions(request);
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
      await this.messages.request_interaction(this.secrets.redact(request) as SessionInteractionRequest);
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
    return this.serialize(async () => {
      const pending = this.require_pending(input.interaction_id);
      this.validate_response(pending.request, input.response);
      if (interaction_questions(pending.request).some((question) => question.type === "secret")) {
        throw new Error("Private questions require the private submission endpoint");
      }
      return this.commit_response(input.interaction_id, this.secrets.redact(input.response) as SessionInteractionResponse);
    });
  }

  /** 受信客户端专用入口；完整校验后只持久化引用回执。 */
  async submit_private_question(input: RespondSessionInteractionInput): Promise<SessionInteractionResult> {
    return this.serialize(async () => {
      const previous = this.private_receipts.get(input.interaction_id);
      if (previous) return structuredClone(previous);
      const pending = this.require_pending(input.interaction_id);
      this.validate_response(pending.request, input.response);
      const prepared = prepare_private_question_response(pending.request, input.response);
      const staged = this.secrets.with_values(prepared.secrets);
      // 只遮罩答案数据，协议状态、类型及字段标识不能被短密码意外改写。
      const prepared_payload = prepared.response.payload as unknown as SessionQuestionResponsePayload;
      const response: SessionInteractionResponse = {
        ...prepared.response,
        payload: {
          answers: prepared_payload.answers.map((answer) => ({
            question_id: answer.question_id,
            value: staged.redact(answer.value) as string | string[],
          })),
        },
      };
      await this.messages.resolve_interaction(input.interaction_id, response);
      this.secrets = staged;
      const result: SessionInteractionResult = { status: "resolved", interaction_id: input.interaction_id, response };
      this.private_receipts.set(input.interaction_id, structuredClone(result));
      this.finish_pending(input.interaction_id, result);
      return result;
    });
  }

  /** 持久化公开响应后再兑现等待者。 */
  private async commit_response(interaction_id: string, response: SessionInteractionResponse): Promise<SessionInteractionResult> {
    await this.messages.resolve_interaction(interaction_id, response);
    const result: SessionInteractionResult = response.outcome === "denied"
      ? { status: "denied", interaction_id, reason: extract_interaction_reason(response.payload) }
      : { status: "resolved", interaction_id, response: structuredClone(response) };
    this.finish_pending(interaction_id, result);
    return result;
  }

  /** 保持队列可继续执行，单次错误只返回给对应提交者。 */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutation_chain.then(operation);
    this.mutation_chain = next.catch(() => undefined);
    return next;
  }

  /**
   * 展开当前 Session 工具输入中的私密变量引用。
   *
   * 关键点（中文）
   * - 只处理字符串值，不解析对象键、工具名或脚本源码字段。
   * - 单次展开，私密值中再次出现的占位符不会递归解析。
   */
  resolve_secret_references(input: JsonValue): JsonValue {
    return this.secrets.resolve(input);
  }

  /** 在执行结果、日志和异常发布前遮罩当前 Session 已知私密值。 */
  redact_secret_values(value: unknown): unknown {
    return this.secrets.redact(value);
  }

  /** 为当前调用创建跨块输出遮罩器，并跟进此 Session 后续私密提交。 */
  create_secret_stream_redactor() {
    return this.secrets.create_stream_redactor(() => this.secrets);
  }

  /** 取消当前 Session 的全部 pending Interaction。 */
  async cancel_all(
    reason: "turn_stopped" | "session_disposed" | "runtime_interrupted",
  ): Promise<void> {
    return this.serialize(async () => {
      if (reason === "session_disposed") this.clear_secrets();
      let first_error: unknown;
      for (const interaction_id of [...this.pending_by_id.keys()]) {
        const result: SessionInteractionResult = { status: "cancelled", interaction_id, reason };
        try {
          await this.messages.close_interaction(interaction_id, { reason });
          this.finish_pending(interaction_id, result);
        } catch (error) {
          first_error ??= error;
        }
      }
      if (first_error) throw first_error;
    });
  }

  /** 释放当前 Session 所有私密值及回执；调用方先停止执行。 */
  clear_secrets(): void {
    this.secrets.clear();
    this.private_receipts.clear();
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
