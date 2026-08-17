/**
 * SessionLoop：Session Command Queue 的唯一消费者与 Turn 生命周期所有者。
 *
 * 关键点（中文）
 * - Prompt 会先构造成 Session Command，再由统一 FIFO 决定进入当前或下一 Turn。
 * - 不把调度逻辑塞进 Executor；Executor 继续只负责单次执行。
 * - Queue 由 Session 持有；这里不解释配置种类，只执行出队 Command。
 */

import { nanoid } from "nanoid";
import type { SessionUserMessageV1 } from "@/executor/types/SessionRecords.js";
import type {
  SessionActionRecordV1,
  SessionRecordV1,
  SessionMessageRecordV1,
} from "@/executor/types/SessionRecords.js";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type { AgentSessionStopResult } from "@/types/sdk/AgentSessionStop.js";
import type {
  AgentSessionTurnHandle,
  AgentSessionTurnResult,
} from "@/types/sdk/AgentSessionTurn.js";
import { extract_text_from_parts } from "@/executor/messages/UIMessageTransformer.js";
import { is_agent_session_prompt_input_empty } from "@/types/sdk/AgentSessionPrompt.js";
import type {
  SessionCompactHistory,
  SessionExecutor,
  SessionTurnExecutionResult,
} from "@/types/session/SessionExecution.js";
import type { SessionTurnContext } from "@/types/executor/SessionTurnContext.js";
import { create_session_turn_context } from "@/session/runtime/SessionTurnContext.js";
import { SessionEventHub } from "@/session/runtime/SessionEventHub.js";
import { SessionState } from "@/session/SessionState.js";
import { SessionMessages } from "@/session/SessionMessages.js";
import type { ShellApprovalGateway } from "@downcity/workspace";
import type {
  SessionInteractionLifecycle,
  SessionInteractionPort,
} from "@/types/session/SessionInteraction.js";
import { SessionAssistantOutputAdapter } from "@/session/execution/SessionAssistantOutputAdapter.js";
import { SessionQueue } from "@/session/SessionQueue.js";
import { SessionCommand } from "@/session/SessionCommand.js";
import type {
  ActiveSessionTurnState,
  SessionDeferred,
  SessionLoopOptions,
} from "@/types/session/SessionLoop.js";
import type { SessionCommandCompletion } from "@/types/session/SessionCommand.js";

const TURN_STOPPED_MESSAGE = "Turn stopped";
const QUEUED_PROMPT_CANCELLED_MESSAGE =
  "Prompt cancelled because session was stopped";

/**
 * Session 输入队列与 Turn 编排器。
 */
export class SessionLoop {
  private readonly session_id: string;
  private readonly workspace_path: string;
  private readonly executor: SessionExecutor;
  private readonly compact_history_handler: SessionCompactHistory;
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
  private checkpoint_merged_messages: SessionUserMessageV1[] | null = null;

  constructor(options: SessionLoopOptions) {
    this.session_id = String(options.session_id || "").trim();
    this.workspace_path = String(options.workspace_path || "").trim();
    this.executor = options.executor;
    this.compact_history_handler = options.compact_history;
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
    const deferred_handle = create_deferred<AgentSessionTurnHandle>();
    this.pending_prompt_count += 1;
    this.queue.enqueue_command(new SessionCommand({
      execute: async () => {
        await this.execute_prompt_command(input, deferred_handle);
      },
      cancel: () => {
        this.pending_prompt_count = Math.max(0, this.pending_prompt_count - 1);
        this.resolve_cancelled_prompt(deferred_handle);
      },
    }));
    this.ensure_processing();
    return await deferred_handle.promise;
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
    return this.processing_promise !== null || this.has_pending_prompt();
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
      if (this.has_pending_prompt()) {
        this.ensure_processing();
      }
    });
  }

  private async process_loop(): Promise<void> {
    while (this.has_pending_prompt()) {
      const turn_id = `turn:${this.session_id}:${Date.now()}:${nanoid(6)}`;
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

      while (this.active_turn === active_turn) {
        const command = this.queue.take_next();
        if (!command) {
          await this.fail_active_turn(
            active_turn,
            new Error("Session Queue lost its pending Prompt Command"),
          );
          break;
        }
        try {
          await this.execute_command(command);
        } catch (error) {
          await this.fail_active_turn(active_turn, error);
        }
      }
    }
  }

  private cancel_queued_prompts(): number {
    return this.queue.cancel();
  }

  /**
   * 在下一 Session step 检查点按入队顺序提交配置并持久化 steer。
   */
  private async drain_queued_inputs(
    active_turn: ActiveSessionTurnState,
  ): Promise<SessionUserMessageV1[]> {
    const drained = this.queue.drain();
    if (drained.length <= 0) return [];
    const merged: SessionUserMessageV1[] = [];
    this.checkpoint_merged_messages = merged;

    try {
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
    } finally {
      this.checkpoint_merged_messages = null;
    }

    return merged;
  }

  /** 执行 Command，并尽力持久化其声明的 canonical 完成信息。 */
  private async execute_command(command: SessionCommand): Promise<void> {
    const completion = await command.execute();
    if (!completion) return;
    await this.persist_command_completion(completion);
  }

  /** 持久化 Command 完成信息；观测失败不能反向改变已经提交的领域状态。 */
  private async persist_command_completion(
    completion: SessionCommandCompletion,
  ): Promise<void> {
    const turn_id = this.require_active_turn().turn_id;
    try {
      await this.persist_action_event({
        type: "action",
        id: completion.id,
        title: completion.title,
        ...(completion.description
          ? { description: completion.description }
          : {}),
        state: "completed",
        metadata: {
          v: 1,
          ts: Date.now(),
          session_id: this.session_id,
          turn_id,
        },
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

  /** 在当前 Turn 上执行一次显式历史压缩。 */
  async compact_history(
    compact_id: string,
  ): ReturnType<SessionCompactHistory> {
    const turn_id = this.require_active_turn().turn_id;
    const result = await this.compact_history_handler({ turn_id });
    if (
      result.compacted &&
      this.active_turn?.turn_context
    ) {
      this.require_active_turn().history_reload_requested = true;
    }
    if (result.reason === "nothing_to_compact") {
      try {
        await this.persist_action_event({
          type: "action",
          id: compact_id,
          title: "Session messages already compact",
          description: "The Session has no active messages to compact.",
          state: "completed",
          metadata: {
            v: 1,
            ts: Date.now(),
            session_id: this.session_id,
            turn_id: turn_id,
          },
        });
      } catch (error) {
        try {
          await this.logger.log("warn", "[agent] compact result persistence failed", {
            session_id: this.session_id,
            compact_id,
            error: error instanceof Error ? error.message : String(error),
          });
        } catch {
          // 领域结果已经确定，Action 与日志失败都不能把成功压缩改写为失败。
        }
      }
    }
    return result;
  }

  /** 执行一个出队 Prompt；首条 Prompt 启动 Turn，后续 Prompt 作为 steer 合并。 */
  private async execute_prompt_command(
    input: AgentSessionPromptInput,
    deferred_handle: SessionDeferred<AgentSessionTurnHandle>,
  ): Promise<void> {
    const active_turn = this.require_active_turn();
    if (active_turn.prompt_started) {
      const message = await this.persist_prompt_message(
        input,
        active_turn.turn_id,
        "steer",
      );
      this.pending_prompt_count = Math.max(0, this.pending_prompt_count - 1);
      deferred_handle.resolve(create_turn_handle(active_turn));
      this.checkpoint_merged_messages?.push(message);
      return;
    }

    active_turn.prompt_started = true;
    this.pending_prompt_count = Math.max(0, this.pending_prompt_count - 1);
    deferred_handle.resolve(create_turn_handle(active_turn));
    try {
      await this.persist_prompt_message(input, active_turn.turn_id, "prompt");
      const result = await this.execute_prompt_turn({
        active_turn,
        prompt_input: input,
      });
      await this.finish_active_turn(active_turn, result);
    } catch (error) {
      await this.fail_active_turn(active_turn, error);
    }
  }

  /** 读取当前正在消费 Session Command 的 Active Turn。 */
  private require_active_turn(): ActiveSessionTurnState {
    if (this.active_turn) return this.active_turn;
    throw new Error("Session Command requires an active Turn");
  }

  /** 用 Executor 结果结束当前 Active Turn。 */
  private async finish_active_turn(
    active_turn: ActiveSessionTurnState,
    result: SessionTurnExecutionResult,
  ): Promise<void> {
    const stopped = active_turn.turn_context?.lifecycle.abort_signal.aborted === true;
    const final_result: AgentSessionTurnResult = {
      turn_id: active_turn.turn_id,
      text: result.text,
      success: stopped ? false : result.success,
      ...(stopped
        ? { error: TURN_STOPPED_MESSAGE }
        : result.error ? { error: result.error } : {}),
    };
    active_turn.result = final_result;
    this.events.publish({
      mutation_id: nanoid(),
      variant: "turn",
      type: "finish",
      session_id: this.session_id,
      turn_id: active_turn.turn_id,
      status: stopped ? "stopped" : final_result.success ? "completed" : "failed",
      created_at: Date.now(),
      text: final_result.text,
      ...(final_result.error ? { error: final_result.error } : {}),
    });
    await this.dispose_turn_context(active_turn);
    active_turn.deferred_finished.resolve(final_result);
    if (this.active_turn === active_turn) this.active_turn = null;
  }

  /** 以失败结果结束当前 Active Turn，并尽力持久化 Error Message。 */
  private async fail_active_turn(
    active_turn: ActiveSessionTurnState,
    error: unknown,
  ): Promise<void> {
    if (active_turn.result) return;
    const stopped = active_turn.turn_context?.lifecycle.abort_signal.aborted === true;
    const message = stopped
      ? TURN_STOPPED_MESSAGE
      : error instanceof Error ? error.message : String(error);
    const final_result: AgentSessionTurnResult = {
      turn_id: active_turn.turn_id,
      text: "",
      success: false,
      error: message,
    };
    active_turn.result = final_result;
    if (message !== TURN_STOPPED_MESSAGE) {
      try {
        await this.messages.append_error_message({
          scope: "turn",
          turn_id: active_turn.turn_id,
          code: "turn_execution_failed",
          message,
          recoverable: true,
        });
      } catch {
        // Error Message 写入失败不能阻止 Turn Handle 收口。
      }
    }
    this.events.publish({
      mutation_id: nanoid(),
      variant: "turn",
      type: "finish",
      session_id: this.session_id,
      turn_id: active_turn.turn_id,
      status: stopped ? "stopped" : "failed",
      created_at: Date.now(),
      text: "",
      error: message,
    });
    await this.dispose_turn_context(active_turn);
    active_turn.deferred_finished.resolve(final_result);
    if (this.active_turn === active_turn) this.active_turn = null;
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
    prompt_input: AgentSessionPromptInput;
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
    const query = input.prompt_input.query;
    const executor_query = typeof query === "string"
      ? query
      : extract_text_from_parts(query);
    let result: SessionTurnExecutionResult;
    result = await this.executor.execute({
      query: executor_query,
      turn_context,
    });

    await assistant_output.finish({
      status: turn_context.lifecycle.abort_signal.aborted
        ? "stopped"
        : result.success
          ? "completed"
          : "failed",
      ...(result.error ? { error: result.error } : {}),
    });

    if (!result.success && !turn_context.lifecycle.abort_signal.aborted && result.error) {
      await this.messages.append_error_message({
        scope: "turn",
        turn_id: input.active_turn.turn_id,
        code: "turn_execution_failed",
        message: result.error,
        recoverable: true,
      });
    }
    await this.state.touch_metadata();
    const deferred_count = await this.messages.append_deferred_user_messages(
      result.deferred_persisted_user_messages,
    );
    if (deferred_count > 0) await this.state.touch_metadata();
    if (result.compact_required) {
      await this.compact_history_handler({
        turn_id: input.active_turn.turn_id,
      });
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
      project_root: this.workspace_path,
      merge_step_input: async () => {
        const merged = await this.drain_queued_inputs(active_turn);
        if (merged.length > 0) await assistant_output.close_current_message();
        return merged;
      },
      has_pending_step_input: () => this.has_pending_prompt(),
      consume_history_reload: () => {
        const requested = active_turn.history_reload_requested;
        active_turn.history_reload_requested = false;
        return requested;
      },
      assistant_output,
      shell_approval_gateway: this.shell_approval_gateway,
      interactions: this.interactions,
      publish_action: async (event) => {
        await this.persist_action_event(event);
      },
    });
  }

  /** 持久化本轮 User 输入，并同步刷新标题与 metadata。 */
  private async persist_prompt_message(
    prompt: AgentSessionPromptInput,
    turn_id: string,
    input_type: "prompt" | "steer",
  ): Promise<SessionUserMessageV1> {
    const message = await this.messages.append_prompt_message({
      project_root: this.workspace_path,
      prompt,
      turn_id,
      input_type,
    });
    this.state.touch_metadata_in_background();
    this.state.schedule_title_generation();
    return message;
  }

  /** 持久化 Executor Action，并同步刷新 Session metadata。 */
  private async persist_action_event(
    event: SessionActionRecordV1,
    options?: { publish_mutation?: boolean },
  ): Promise<void> {
    await this.messages.persist_action_record(event, options);
    await this.state.touch_metadata();
  }

  /** 由 Turn 生命周期所有者尽力释放其唯一 Context。 */
  private async dispose_turn_context(
    active_turn: ActiveSessionTurnState,
  ): Promise<void> {
    try {
      await active_turn.turn_context?.lifecycle.dispose();
    } catch (error) {
      try {
        await this.logger.log("warn", "[agent] turn context disposal failed", {
          session_id: this.session_id,
          turn_id: active_turn.turn_id,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Context 已进入释放流程，日志失败不能阻止 Turn Handle 收口。
      }
    }
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
    history_reload_requested: false,
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
