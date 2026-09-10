/**
 * SessionLoop：Session Command Queue 的唯一消费者与 Turn 生命周期所有者。
 *
 * 关键点（中文）
 * - Prompt 会先构造成 Session Command，再由统一 FIFO 决定进入当前或下一 Turn。
 * - 不把调度逻辑塞进 Executor；Executor 继续只负责单次执行。
 * - Queue 由 Session 持有；这里不解释配置种类，只执行出队 Command。
 */

import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import type { SessionAgentMessage, SessionUserMessage } from "@downcity/type";
import type { SessionActionEvent } from "@downcity/type";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type { AgentSessionStopResult } from "@/types/sdk/AgentSessionStop.js";
import type {
  AgentSessionTurnHandle,
  AgentSessionTurnResult,
} from "@/types/sdk/AgentSessionTurn.js";
import { is_agent_session_prompt_input_empty } from "@/types/sdk/AgentSessionPrompt.js";
import type {
  SessionExecutor,
  SessionTurnExecutionResult,
} from "@/types/session/SessionExecution.js";
import type { SessionTurnContext } from "@/types/executor/SessionTurnContext.js";
import { create_session_turn_context } from "@/session/runtime/SessionTurnContext.js";
import { SessionEventHub } from "@/session/runtime/SessionEventHub.js";
import { SessionState } from "@/session/SessionState.js";
import {
  normalize_session_user_parts,
  SessionMessages,
} from "@/session/SessionMessages.js";
import type { ShellApprovalGateway } from "@downcity/type";
import type {
  SessionInteractionLifecycle,
  SessionInteractionPort,
} from "@downcity/type";
import { SessionAssistantOutputAdapter } from "@/session/execution/SessionAssistantOutputAdapter.js";
import { SessionQueue } from "@/session/SessionQueue.js";
import { extract_session_message_text } from "@/session/messages/SessionMessageText.js";
import type {
  ActiveSessionTurnState,
  SessionDeferred,
  SessionLoopOptions,
} from "@/types/session/SessionLoop.js";
import type {
  SessionCommand,
  SessionCommandCompletion,
} from "@/types/session/SessionCommand.js";
import { create_session_model_request_warning } from "@/session/runtime/SessionModelRequestWarning.js";
import {
  complete_session_turn,
  fail_session_turn,
} from "@/session/runtime/SessionTurnCompletion.js";
import {
  append_session_turn_file_diff,
  publish_session_turn_file_diff,
} from "@/session/runtime/SessionTurnFileDiff.js";
import type { SessionTurnCompletionOptions } from "@/types/session/SessionTurnCompletion.js";

const TURN_STOPPED_MESSAGE = "Turn stopped";
const QUEUED_PROMPT_CANCELLED_MESSAGE =
  "Prompt cancelled because session was stopped";

/**
 * Session 输入队列与 Turn 编排器。
 */
export class SessionLoop {
  private readonly session_id: string;
  private readonly session_origin: SessionLoopOptions["session_origin"];
  private readonly workspace_path: string;
  private readonly executor: SessionExecutor;
  private readonly maintain_context: SessionLoopOptions["maintain_context"];
  private readonly state: SessionState;
  private readonly messages: SessionMessages;
  private readonly events: SessionEventHub;
  private readonly logger: SessionLoopOptions["logger"];
  private readonly interactions:
    SessionInteractionLifecycle & SessionInteractionPort;
  private readonly shell_approval_gateway: ShellApprovalGateway;
  private readonly queue: SessionQueue;
  private pending_prompt_count = 0;
  private processing_promise: Promise<void> | null = null;
  private active_turn: ActiveSessionTurnState | null = null;
  /** 尚未完成 canonical 接收的幂等 Prompt，防止进程内并发重复入队。 */
  private readonly pending_request_handles = new Map<string, Promise<AgentSessionTurnHandle>>();

  constructor(options: SessionLoopOptions) {
    this.session_id = String(options.session_id || "").trim();
    this.session_origin = options.session_origin;
    this.workspace_path = String(options.workspace_path || "").trim();
    this.executor = options.executor;
    this.maintain_context = options.maintain_context;
    this.state = options.state;
    this.messages = options.messages;
    this.events = options.events;
    this.logger = options.logger;
    this.queue = options.queue;
    this.interactions = options.interactions;
    this.shell_approval_gateway = options.shell_approval_gateway;
    if (!this.session_id) {
      throw new Error("SessionLoop requires a non-empty session_id");
    }
    if (!this.workspace_path) {
      throw new Error("SessionLoop requires a non-empty workspace_path");
    }
  }

  /**
   * 追加一条新的 prompt。
   */
  async prompt(input: AgentSessionPromptInput): Promise<AgentSessionTurnHandle> {
    if (is_agent_session_prompt_input_empty(input)) {
      throw new Error("session.prompt requires a non-empty query");
    }
    await this.state.ensure_runnable();
    const request_identity = resolve_prompt_request_identity(this.session_id, input.request_id);
    if (!request_identity) return await this.enqueue_prompt(input);
    const pending_handle = this.pending_request_handles.get(request_identity.turn_id);
    if (pending_handle) return await pending_handle;
    const operation = this.prompt_with_identity(input, request_identity);
    this.pending_request_handles.set(request_identity.turn_id, operation);
    try {
      return await operation;
    } finally {
      if (this.pending_request_handles.get(request_identity.turn_id) === operation) {
        this.pending_request_handles.delete(request_identity.turn_id);
      }
    }
  }

  /** 解析已有幂等结果，或把同一个稳定 Prompt 加入队列。 */
  private async prompt_with_identity(
    input: AgentSessionPromptInput,
    request_identity: PromptRequestIdentity,
  ): Promise<AgentSessionTurnHandle> {
    const existing_handle = await this.resolve_idempotent_prompt(request_identity);
    if (existing_handle) return existing_handle;
    const persisted_message = this.messages.get_message(request_identity.message_id);
    return await this.enqueue_prompt(input, request_identity, persisted_message?.role === "user"
      ? persisted_message
      : undefined);
  }

  /** 把一个已校验的 Prompt 加入 Session FIFO。 */
  private async enqueue_prompt(
    input: AgentSessionPromptInput,
    request_identity?: PromptRequestIdentity,
    persisted_message?: SessionUserMessage,
  ): Promise<AgentSessionTurnHandle> {
    const deferred_handle = create_deferred<AgentSessionTurnHandle>();
    this.pending_prompt_count += 1;
    this.enqueue_command({
      kind: "prompt",
      ...(request_identity ? { turn_id: request_identity.turn_id } : {}),
      execute: async () => {
        await this.execute_prompt_command(
          input,
          deferred_handle,
          request_identity?.message_id,
          persisted_message,
        );
      },
      cancel: () => {
        this.pending_prompt_count = Math.max(0, this.pending_prompt_count - 1);
        this.resolve_cancelled_prompt(deferred_handle);
      },
    });
    return await deferred_handle.promise;
  }

  /** 追加 Command，并确保空闲 Session 也会主动消费维护操作。 */
  enqueue_command(command: SessionCommand): void {
    this.queue.enqueue_command(command);
    this.ensure_processing();
  }

  /**
   * 判断是否存在等待并入下一 Session step 的 prompt。
   */
  has_pending_prompt(): boolean {
    return this.pending_prompt_count > 0;
  }

  /**
   * 判断是否存在等待在下一 Session step 检查点执行的 command。
   */
  has_pending_command(): boolean {
    return this.queue.has_command();
  }

  /** 返回当前正在消费 Session Command 的 Turn 标识。 */
  get_active_turn_id(): string {
    return this.require_active_turn().turn_id;
  }

  /** 返回当前 Active Turn 标识；Session 空闲时返回 undefined。 */
  current_turn_id(): string | undefined {
    return this.active_turn?.turn_id;
  }

  /**
   * 返回当前 actor prompt 调度器是否仍处于活跃态。
   *
   * 说明（中文）
   * - 只要还有排队 prompt，或处理循环尚未结束，就视为活跃。
   * - Session 会用它阻止内部 direct execution 与 actor 模式并发混用。
   */
  is_active(): boolean {
    return this.processing_promise !== null || this.has_pending_command();
  }

  /**
   * 停止当前 turn，并取消尚未被吸收的排队 prompt。
   */
  async stop(): Promise<AgentSessionStopResult> {
    const active_turn = this.active_turn;
    const cancelled_queued_prompts = this.cancel_queued_prompts();

    active_turn?.turn_context?.lifecycle.abort(
      new Error(TURN_STOPPED_MESSAGE),
    );

    await this.interactions.cancel_all("turn_stopped");

    const stopped = Boolean(
      active_turn ||
        cancelled_queued_prompts > 0,
    );
    return {
      stopped,
      ...(active_turn ? { turn_id: active_turn.turn_id } : {}),
      cancelled_queued_prompts: cancelled_queued_prompts,
      reason: stopped ? "stopped" : "idle",
    };
  }

  private ensure_processing(): void {
    if (this.processing_promise) return;
    this.processing_promise = this.process_loop().finally(() => {
      this.processing_promise = null;
      if (this.has_pending_command()) {
        this.ensure_processing();
      }
    });
  }

  private async process_loop(): Promise<void> {
    while (this.has_pending_command()) {
      const command = this.queue.take_next();
      if (!command) return;
      if (command.kind === "maintenance") {
        await this.execute_maintenance_command(command);
        continue;
      }

      const turn_id = command.turn_id || `turn:${this.session_id}:${Date.now()}:${nanoid(6)}`;
      const active_turn = create_active_session_turn_state(turn_id);
      this.active_turn = active_turn;
      active_turn.turn_context = this.create_turn_context(active_turn);
      this.events.publish({
        mutation_id: nanoid(),
        variant: "turn",
        type: "start",
        session_id: this.session_id,
        turn_id,
        status: "running",
        created_at: Date.now(),
      });

      try {
        await this.execute_command(command);
      } catch (error) {
        await this.fail_active_turn(active_turn, error);
      }
    }
  }

  /** 在没有 Active Turn 时执行 Session 级维护命令。 */
  private async execute_maintenance_command(command: SessionCommand): Promise<void> {
    try {
      await this.execute_command(command);
    } catch (error) {
      try {
        await this.logger.log("warn", "[agent] session maintenance command failed", {
          session_id: this.session_id,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Maintenance Command 已经失败，日志失败不能阻止后续 Command 继续执行。
      }
    }
  }

  private cancel_queued_prompts(): number {
    return this.queue.cancel();
  }

  /**
   * 在下一 Session step 检查点按入队顺序提交配置并持久化 steer。
   */
  private async drain_queued_inputs(): Promise<void> {
    const drained = this.queue.drain();
    if (drained.length <= 0) return;

    for (let index = 0; index < drained.length; index += 1) {
      const command = drained[index];
      try {
        await this.execute_command(command);
      } catch {
        // Prompt 持久化失败时恢复尚未处理的对象；Action 自己负责失败观测。
        this.queue.restore_front(drained.slice(index));
        break;
      }
    }
  }

  /** 执行 Command，并尽力持久化其声明的 canonical 完成信息。 */
  private async execute_command(command: SessionCommand): Promise<void> {
    await command.execute();
    const completion = command.completion;
    if (!completion) return;
    await this.persist_command_completion(completion);
  }

  /** 持久化 Command 完成信息；观测失败不能反向改变已经提交的领域状态。 */
  private async persist_command_completion(
    completion: SessionCommandCompletion,
  ): Promise<void> {
    const turn_id = this.current_turn_id();
    try {
      await this.persist_action_event({
        action_id: completion.id,
        action_type: "command",
        ...(turn_id ? { turn_id } : {}),
        title: completion.title,
        ...(completion.description
          ? { description: completion.description }
          : {}),
        status: "completed",
      }, {
        publish_mutation: completion.publish_mutation !== false,
      });
    } catch (error) {
      try {
        await this.logger.log("warn", "[agent] command completion persistence failed", {
          session_id: this.session_id,
          command_id: completion.id,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // 领域状态已经提交，日志失败同样不能反向改变 Command 结果。
      }
    }
  }

  /** 执行一个出队 Prompt；首条 Prompt 启动 Turn，后续 Prompt 作为 steer 合并。 */
  private async execute_prompt_command(
    input: AgentSessionPromptInput,
    deferred_handle: SessionDeferred<AgentSessionTurnHandle>,
    message_id?: string,
    persisted_message?: SessionUserMessage,
  ): Promise<void> {
    const active_turn = this.require_active_turn();
    if (active_turn.prompt_started) {
      const message = await this.persist_prompt_message(
        input,
        active_turn.turn_id,
      );
      active_turn.turn_context?.input.observe_user_message(message);
      this.pending_prompt_count = Math.max(0, this.pending_prompt_count - 1);
      deferred_handle.resolve(create_turn_handle(active_turn));
      return;
    }

    active_turn.prompt_started = true;
    this.pending_prompt_count = Math.max(0, this.pending_prompt_count - 1);
    let handle_resolved = false;
    try {
      const message = persisted_message || await this.persist_prompt_message(
          input,
          active_turn.turn_id,
          message_id,
        );
      active_turn.turn_context?.input.observe_user_message(message);
      // 只有 canonical user message 已经写入 Session 后，调用方才认为输入被接收。
      deferred_handle.resolve(create_turn_handle(active_turn));
      handle_resolved = true;
      const result = await this.execute_prompt_turn({
        active_turn,
      });
      const final_result = await complete_session_turn(
        this.turn_completion_options(),
        active_turn,
        result,
      );
      if (this.active_turn === active_turn) this.active_turn = null;
      active_turn.deferred_finished.resolve(final_result);
    } catch (error) {
      // 持久化失败时仍兑现句柄，让调用方可以观察到失败的 Turn，而不是永久等待。
      if (!handle_resolved) deferred_handle.resolve(create_turn_handle(active_turn));
      await this.fail_active_turn(active_turn, error);
    }
  }

  /** 读取当前正在消费 Session Command 的 Active Turn。 */
  private require_active_turn(): ActiveSessionTurnState {
    if (this.active_turn) return this.active_turn;
    throw new Error("Session Command requires an active Turn");
  }

  /** 以失败结果结束当前 Active Turn，并尽力持久化包含 Error Part 的 Agent Message。 */
  private async fail_active_turn(
    active_turn: ActiveSessionTurnState,
    error: unknown,
  ): Promise<void> {
    const final_result = await fail_session_turn(
      this.turn_completion_options(),
      active_turn,
      error,
    );
    if (this.active_turn === active_turn) this.active_turn = null;
    active_turn.deferred_finished.resolve(final_result);
  }

  /** 为一条尚未执行的 Prompt 创建可观测取消结果。 */
  private resolve_cancelled_prompt(
    deferred_handle: SessionDeferred<AgentSessionTurnHandle>,
  ): void {
    const turn_id = `turn:${this.session_id}:cancelled:${Date.now()}:${nanoid(6)}`;
    const cancelled_turn = create_active_session_turn_state(turn_id);
    const final_result: AgentSessionTurnResult = {
      turn_id,
      text: "",
      success: false,
      error: QUEUED_PROMPT_CANCELLED_MESSAGE,
    };
    cancelled_turn.result = final_result;
    cancelled_turn.deferred_finished.resolve(final_result);
    this.events.publish({
      mutation_id: nanoid(),
      variant: "turn",
      type: "start",
      session_id: this.session_id,
      turn_id,
      status: "running",
      created_at: Date.now(),
    });
    this.events.publish({
      mutation_id: nanoid(),
      variant: "turn",
      type: "finish",
      session_id: this.session_id,
      turn_id,
      status: "failed",
      created_at: Date.now(),
      text: "",
      error: QUEUED_PROMPT_CANCELLED_MESSAGE,
    });
    deferred_handle.resolve(create_turn_handle(cancelled_turn));
  }

  /** 执行一个 Turn 内的模型与 Tool Step Loop。 */
  private async execute_prompt_turn(input: {
    active_turn: ActiveSessionTurnState;
  }): Promise<{
    text: string;
    success: boolean;
    error?: string;
  }> {
    const turn_context = input.active_turn.turn_context;
    const assistant_output = turn_context?.output.assistant;
    if (!turn_context || !assistant_output) {
      throw new Error("Active Session Turn requires an initialized context");
    }
    let result: SessionTurnExecutionResult;
    try {
      result = await this.executor.execute({ turn_context });
    } catch (error) {
      result = {
        text: "",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    if (!result.success && !turn_context.lifecycle.abort_signal.aborted && result.error) {
      await assistant_output.append_error({
        scope: "turn",
        code: "turn_execution_failed",
        message: result.error,
        recoverable: true,
      });
    }

    await append_session_turn_file_diff({
      session_id: this.session_id,
      turn_id: input.active_turn.turn_id,
      workspace_path: this.workspace_path,
      turn_context,
      assistant_output,
      logger: this.logger,
    });

    await assistant_output.finish({
      status: turn_context.lifecycle.abort_signal.aborted
        ? "stopped"
        : result.success
          ? "completed"
          : "failed",
      ...(result.error ? { error: result.error } : {}),
    });

    if (result.compact_required) {
      await this.maintain_context();
    }
    return {
      text: result.text,
      success: result.success,
      ...(result.error ? { error: result.error } : {}),
    };
  }

  /** 在 Turn 创建时建立其唯一执行上下文和 Assistant 输出端口。 */
  private create_turn_context(
    active_turn: ActiveSessionTurnState,
  ): SessionTurnContext {
    const assistant_output = new SessionAssistantOutputAdapter({
      turn_id: active_turn.turn_id,
      messages: this.messages,
    });
    return create_session_turn_context({
      turn_id: active_turn.turn_id,
      session_id: this.session_id,
      session_origin: this.session_origin,
      project_root: this.workspace_path,
      commit_step_input: async () => {
        const had_pending_prompt = this.has_pending_prompt();
        await this.drain_queued_inputs();
        if (had_pending_prompt) await assistant_output.close_current_message();
      },
      append_internal_user_message: async (parts) => {
        const message = await this.messages.append_user_message({
          turn_id: active_turn.turn_id,
          visibility: "internal",
          parts: normalize_session_user_parts([...parts]),
        });
        active_turn.turn_context?.input.observe_user_message(message);
        return message;
      },
      has_pending_step_input: () => this.has_pending_prompt(),
      assistant_output,
      shell_approval_gateway: this.shell_approval_gateway,
      interactions: this.interactions,
      on_effects_changed: (effects) => {
        publish_session_turn_file_diff({
          session_id: this.session_id,
          turn_id: active_turn.turn_id,
          workspace_path: this.workspace_path,
          effects,
          publish: (mutation) => this.events.publish(mutation),
          logger: this.logger,
        });
      },
      publish_action: async (event) => {
        await this.persist_action_event(event);
      },
      report_model_request_failure: (notice) => {
        this.events.publish(create_session_model_request_warning({
          session_id: this.session_id,
          turn_id: active_turn.turn_id,
          notice,
        }));
      },
    });
  }

  /** 持久化本轮 User 输入，并同步刷新标题与 metadata。 */
  private async persist_prompt_message(
    prompt: AgentSessionPromptInput,
    turn_id: string,
    message_id?: string,
  ): Promise<SessionUserMessage> {
    const message = await this.messages.append_prompt_message({
      project_root: this.workspace_path,
      prompt,
      turn_id,
      ...(message_id ? { message_id } : {}),
    });
    this.state.schedule_title_generation();
    return message;
  }

  /** 解析已经持久化或仍在执行的幂等 Prompt。 */
  private async resolve_idempotent_prompt(
    identity: PromptRequestIdentity,
  ): Promise<AgentSessionTurnHandle | null> {
    const existing_message = this.messages.get_message(identity.message_id);
    if (!existing_message) return null;
    if (existing_message.role !== "user" || existing_message.turn_id !== identity.turn_id) {
      throw new Error("Session prompt request identity conflicts with canonical history");
    }
    if (this.active_turn?.turn_id === identity.turn_id) {
      return create_turn_handle(this.active_turn);
    }
    const agent_message = await this.messages.read_latest_agent_message(identity.turn_id);
    if (!agent_message || agent_message.state === "streaming") return null;
    return create_completed_turn_handle(to_persisted_turn_result(identity.turn_id, agent_message));
  }

  /** 持久化 Executor Action，并同步刷新 Session metadata。 */
  private async persist_action_event(
    event: SessionActionEvent,
    options?: { publish_mutation?: boolean },
  ): Promise<void> {
    await this.messages.persist_action(event, options);
  }

  /** 为 Turn 收口领域函数投影稳定依赖。 */
  private turn_completion_options(): SessionTurnCompletionOptions {
    return {
      session_id: this.session_id,
      messages: this.messages,
      events: this.events,
      logger: this.logger,
      stopped_message: TURN_STOPPED_MESSAGE,
    };
  }
}

function create_deferred<T>(): SessionDeferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((inner_resolve) => {
    resolve = inner_resolve;
  });
  return {
    promise,
    resolve,
  };
}

function create_active_session_turn_state(
  turn_id: string,
): ActiveSessionTurnState {
  return {
    turn_id,
    result: null,
    deferred_finished: create_deferred<AgentSessionTurnResult>(),
    turn_context: null,
    prompt_started: false,
  };
}

function create_turn_handle(
  active_turn: ActiveSessionTurnState,
): AgentSessionTurnHandle {
  return {
    id: active_turn.turn_id,
    get result() {
      return active_turn.result;
    },
    finished: active_turn.deferred_finished.promise,
  };
}

/** 幂等 Prompt 在 canonical history 中使用的稳定身份。 */
interface PromptRequestIdentity {
  /** 稳定 User Message ID。 */
  message_id: string;
  /** 稳定 Turn ID。 */
  turn_id: string;
}

/** 把调用方业务键映射为不暴露原值的 Session 内稳定身份。 */
function resolve_prompt_request_identity(
  session_id: string,
  request_id_input: string | undefined,
): PromptRequestIdentity | null {
  const request_id = String(request_id_input || "").trim();
  if (!request_id) return null;
  if (request_id.length > 512) {
    throw new Error("session.prompt request_id must not exceed 512 characters");
  }
  const digest = createHash("sha256")
    .update(session_id)
    .update("\u0000")
    .update(request_id)
    .digest("hex");
  return {
    message_id: `user-request:${digest}`,
    turn_id: `turn-request:${digest}`,
  };
}

/** 从已完成的 canonical Agent Message 恢复 Turn 结果。 */
function to_persisted_turn_result(
  turn_id: string,
  message: SessionAgentMessage,
): AgentSessionTurnResult {
  const error_part = [...message.parts].reverse().find((part) => part.type === "error");
  const error = error_part?.type === "error" ? error_part.message : undefined;
  const success = !error;
  return {
    turn_id,
    text: extract_session_message_text(message),
    success,
    ...(!success ? { error } : {}),
  };
}

/** 为已经持久化完成的 Turn 创建立即兑现的句柄。 */
function create_completed_turn_handle(
  result: AgentSessionTurnResult,
): AgentSessionTurnHandle {
  return {
    id: result.turn_id,
    result,
    finished: Promise.resolve(result),
  };
}
