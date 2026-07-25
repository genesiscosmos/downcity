/**
 * SessionTurn：Session 输入队列与 Turn 生命周期的唯一所有者。
 *
 * 关键点（中文）
 * - `prompt()` 是唯一输入入口，内部决定并入当前 turn 还是排到下一 turn。
 * - 不把调度逻辑塞进 Executor；Executor 继续只负责单次执行。
 * - 这里不暴露历史或消息模型，只编排 prompt 队列与 turn 生命周期。
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
import type { SessionQueueCommand } from "@/types/session/SessionQueue.js";
import type {
  AgentSessionTurnHandle,
  AgentSessionTurnResult,
} from "@/types/sdk/AgentSessionTurn.js";
import { extractTextFromParts, extractTextFromUiMessage } from "@/executor/messages/UIMessageTransformer.js";
import type { Executor } from "@/executor/Executor.js";
import { isAgentSessionPromptInputEmpty } from "@/types/sdk/AgentSessionPrompt.js";
import type { SessionRunResult } from "@/executor/types/SessionRun.js";
import type { SessionRunContext } from "@/types/executor/SessionRunContext.js";
import { SessionEventHub } from "@/session/runtime/SessionEventHub.js";
import { SessionState } from "@/session/SessionState.js";
import {
  SessionAssistantMessageWriter,
  SessionMessages,
} from "@/session/SessionMessages.js";
import { from_ui_assistant_parts } from "@/session/messages/SessionMessageCodec.js";
import { generateId } from "@/utils/Id.js";
import type { SessionApprovalBroker } from "@/session/approval/SessionApprovalBroker.js";
import { SessionQueue } from "@/session/SessionQueue.js";
import type {
  ActiveSessionTurnState,
  SessionDeferred,
  SessionTurnOptions,
} from "@/types/session/SessionTurn.js";

const TURN_STOPPED_MESSAGE = "Turn stopped";
const QUEUED_PROMPT_CANCELLED_MESSAGE =
  "Prompt cancelled because session was stopped";

/**
 * Session 输入队列与 Turn 编排器。
 */
export class SessionTurn {
  private readonly session_id: string;
  private readonly workspace_path: string;
  private readonly executor: Executor;
  private readonly state: SessionState;
  private readonly messages: SessionMessages;
  private readonly events: SessionEventHub;
  private readonly approvals: SessionApprovalBroker;
  private readonly apply_command: SessionTurnOptions["apply_command"];
  private readonly queue = new SessionQueue();
  private processing_promise: Promise<void> | null = null;
  private active_turn: ActiveSessionTurnState | null = null;
  private active_run_context: SessionRunContext | null = null;
  private request_active_history_reload: (() => void) | null = null;

  constructor(options: SessionTurnOptions) {
    this.session_id = String(options.session_id || "").trim();
    this.workspace_path = String(options.workspace_path || "").trim();
    this.executor = options.executor;
    this.state = options.state;
    this.messages = options.messages;
    this.events = options.events;
    this.approvals = options.approvals;
    this.apply_command = options.apply_command;
    if (!this.session_id) {
      throw new Error("SessionTurn requires a non-empty sessionId");
    }
    if (!this.workspace_path) {
      throw new Error("SessionTurn requires a non-empty workspace_path");
    }
  }

  /**
   * 追加一条新的 prompt。
   */
  async prompt(input: AgentSessionPromptInput): Promise<AgentSessionTurnHandle> {
    if (isAgentSessionPromptInputEmpty(input)) {
      throw new Error("session.prompt requires a non-empty query");
    }
    await this.state.ensure_runnable();
    const handle_promise = this.queue.enqueue_prompt(input);
    this.ensure_processing();
    return await handle_promise;
  }

  /**
   * 把一次已成功创建的 command 加入统一输入队列。
   */
  enqueue_command(command: SessionQueueCommand): void {
    this.queue.enqueue_command(command);
  }

  /** 把显式历史压缩加入统一输入队列。 */
  async compact(): Promise<void> {
    await this.state.ensure_runnable();
    this.enqueue_command({ type: "compact", command_id: generateId() });
  }

  /**
   * 判断是否存在等待并入下一 Session step 的 prompt。
   */
  has_pending_prompt(): boolean {
    return this.queue.has_prompt();
  }

  /**
   * 判断是否存在等待在下一 Session step 检查点执行的 command。
   */
  has_pending_command(): boolean {
    return this.queue.has_command();
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
  stop(): AgentSessionStopResult {
    const active_turn = this.active_turn;
    const cancelled_queued_prompts = this.cancel_queued_prompts();
    let executor_stop_requested = false;

    if (active_turn) {
      if (!active_turn.abort_controller.signal.aborted) {
        active_turn.abort_controller.abort(new Error(TURN_STOPPED_MESSAGE));
      }
      executor_stop_requested = this.executor.stop();
    }

    const stopped = Boolean(
      active_turn ||
        executor_stop_requested ||
        cancelled_queued_prompts > 0,
    );
    return {
      stopped,
      ...(active_turn ? { turnId: active_turn.turn_id } : {}),
      cancelledQueuedPrompts: cancelled_queued_prompts,
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
      const next = this.queue.take_next_prompt();
      if (!next) break;
      const current = next.prompt;

      const turn_id = `turn:${this.session_id}:${Date.now()}:${nanoid(6)}`;
      const active_turn = create_active_session_turn_state(turn_id);
      this.active_turn = active_turn;
      this.events.publish({
        mutation_id: nanoid(),
        variant: "turn",
        type: "start",
        session_id: this.session_id,
        turn_id,
        status: "running",
        created_at: Date.now(),
      });
      current.deferred_handle.resolve(create_turn_handle(active_turn));

      try {
        await this.execute_commands(
          next.commands,
          active_turn,
        );
        await this.persist_prompt_message(
          current.input,
          turn_id,
          "prompt",
        );
        const result = await this.execute_prompt_turn({
          turn_id,
          prompt_input: current.input,
          on_step_merge: async () => {
            return await this.drain_queued_inputs(active_turn);
          },
          abort_signal: active_turn.abort_controller.signal,
        });
        const stopped = active_turn.abort_controller.signal.aborted;
        const final_result: AgentSessionTurnResult = {
          turnId: turn_id,
          text: result.text,
          success: stopped ? false : result.success,
          ...(result.assistantMessage
            ? { assistantMessage: result.assistantMessage }
            : {}),
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
          turn_id,
          status: stopped ? "stopped" : final_result.success ? "completed" : "failed",
          created_at: Date.now(),
          text: final_result.text,
          ...(final_result.error ? { error: final_result.error } : {}),
        });
        active_turn.deferred_finished.resolve(final_result);
      } catch (error) {
        const message = active_turn.abort_controller.signal.aborted
          ? TURN_STOPPED_MESSAGE
          : error instanceof Error ? error.message : String(error);
        const final_result: AgentSessionTurnResult = {
          turnId: turn_id,
          text: "",
          success: false,
          error: message,
        };
        active_turn.result = final_result;
        if (message !== TURN_STOPPED_MESSAGE) {
          try {
            await this.messages.append_error_message({
              scope: "turn",
              turn_id,
              code: "turn_execution_failed",
              message,
              recoverable: true,
            });
          } catch {
            // Error Message 写入失败不能阻止 turn handle 收口。
          }
        }
        this.events.publish({
          mutation_id: nanoid(),
          variant: "turn",
          type: "finish",
          session_id: this.session_id,
          turn_id,
          status: active_turn.abort_controller.signal.aborted ? "stopped" : "failed",
          created_at: Date.now(),
          text: "",
          error: message,
        });
        active_turn.deferred_finished.resolve(final_result);
      } finally {
        if (this.active_turn === active_turn) {
          this.active_turn = null;
        }
      }
    }
  }

  private cancel_queued_prompts(): number {
    const cancelled = this.queue.cancel_prompts();
    if (cancelled.length <= 0) return 0;
    for (const item of cancelled) {
      const turn_id = `turn:${this.session_id}:cancelled:${Date.now()}:${nanoid(6)}`;
      const cancelled_turn = create_active_session_turn_state(turn_id);
      const final_result: AgentSessionTurnResult = {
        turnId: turn_id,
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
      item.deferred_handle.resolve(create_turn_handle(cancelled_turn));
    }
    return cancelled.length;
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

    for (let index = 0; index < drained.length; index += 1) {
      const item = drained[index];
      if (item.type !== "prompt") {
        try {
          await this.execute_queue_command(item, active_turn.turn_id);
        } catch {
          // command 自己负责失败观测；单条失败不能吞掉后续 steer 或 command。
        }
        continue;
      }
      try {
        const message = await this.persist_prompt_message(
          item.input,
          active_turn.turn_id,
          "steer",
        );
        item.deferred_handle.resolve(create_turn_handle(active_turn));
        merged.push(message);
      } catch {
        // 关键点（中文）：若某条消息持久化失败，把未处理部分重新放回队列头部，避免静默丢失。
        const remaining = drained.slice(index);
        this.queue.restore_front(remaining);
        break;
      }
    }

    return merged;
  }

  /**
   * 执行一组已经从统一队列截取的 command。
   */
  private async execute_commands(
    commands: SessionQueueCommand[],
    active_turn: ActiveSessionTurnState,
  ): Promise<void> {
    if (commands.length <= 0) return;
    for (const command of commands) {
      try {
        await this.execute_queue_command(command, active_turn.turn_id);
      } catch {
        // command 自己负责失败观测；单条失败不能阻断当前 prompt。
      }
    }
  }

  /** 在 Step 检查点解释并提交一条领域命令。 */
  private async execute_queue_command(
    command: SessionQueueCommand,
    turn_id: string,
  ): Promise<void> {
    if (command.type !== "compact") {
      await this.apply_command(command, turn_id);
      return;
    }

    const run_context = this.active_run_context ||
      this.create_compaction_run_context(turn_id);
    const result = await this.executor.compact_history(run_context);
    if (
      result.compacted &&
      this.active_run_context !== null &&
      run_context === this.active_run_context
    ) {
      this.request_active_history_reload?.();
    }
    if (result.reason === "nothing_to_compact") {
      await this.persist_action_event({
        type: "action",
        id: `compacting:${this.session_id}:${command.command_id}`,
        title: "Session messages already compact",
        description: "The Session has no active messages to compact.",
        state: "completed",
        metadata: {
          v: 1,
          ts: Date.now(),
          sessionId: this.session_id,
          turnId: turn_id,
        },
      });
    }
  }

  /** 执行一个 Turn 内的模型与 Tool Step Loop。 */
  private async execute_prompt_turn(input: {
    turn_id: string;
    prompt_input: AgentSessionPromptInput;
    on_step_merge: () => Promise<SessionUserMessageV1[]>;
    abort_signal?: AbortSignal;
  }): Promise<{
    text: string;
    success: boolean;
    assistantMessage?: SessionMessageRecordV1 | null;
    error?: string;
  }> {
    const assistant_writer_ref: {
      current: SessionAssistantMessageWriter | null;
    } = { current: null };
    let assistant_writer_task: Promise<SessionAssistantMessageWriter> | null = null;
    let assistant_segment_index = 0;
    let history_reload_requested = false;

    const ensure_assistant_writer = async (): Promise<SessionAssistantMessageWriter> => {
      if (assistant_writer_ref.current) return assistant_writer_ref.current;
      if (assistant_writer_task) return await assistant_writer_task;
      assistant_segment_index += 1;
      assistant_writer_task = this.messages.open_assistant_message({
        turn_id: input.turn_id,
        segment_index: assistant_segment_index,
      });
      try {
        assistant_writer_ref.current = await assistant_writer_task;
        return assistant_writer_ref.current;
      } finally {
        assistant_writer_task = null;
      }
    };

    const run_context: SessionRunContext = {
      turnId: input.turn_id,
      sessionId: this.session_id,
      projectRoot: this.workspace_path,
      onStepCallback: async () => {
        if (this.has_pending_command() && assistant_writer_ref.current) {
          await assistant_writer_ref.current.complete();
          assistant_writer_ref.current = null;
        }
        const merged = await input.on_step_merge();
        if (merged.length > 0 && assistant_writer_ref.current) {
          await assistant_writer_ref.current.complete();
          assistant_writer_ref.current = null;
        }
        return merged;
      },
      hasPendingStepInput: () => this.has_pending_prompt(),
      consume_history_reload: () => {
        const requested = history_reload_requested;
        history_reload_requested = false;
        return requested;
      },
      onUiMessageChunkCallback: async (chunk) => {
        if (!is_assistant_content_chunk(chunk.type)) return;
        const writer = await ensure_assistant_writer();
        await writer.apply_chunk(chunk);
      },
      on_ui_message_step_start: async () => {
        const writer = await ensure_assistant_writer();
        await writer.begin_step();
      },
      on_ui_message_step_finish: async (message) => {
        const writer = await ensure_assistant_writer();
        await writer.finish_step(from_ui_assistant_parts(message.parts));
      },
      on_ui_message_step_abort: async () => {
        const writer = assistant_writer_ref.current;
        if (writer) await writer.abort_step();
      },
      on_tool_input_ready: async (tool_input) => {
        const writer = await ensure_assistant_writer();
        await writer.prepare_tool_input(tool_input);
      },
      shell_approval_gateway: this.approvals,
      onActionCallback: async (event) => {
        await this.persist_action_event(event);
      },
      injectedUserMessages: [],
      deferredPersistedUserMessages: [],
      pendingAssistantFileParts: [],
      ...(input.abort_signal ? { abortSignal: input.abort_signal } : {}),
    };
    const query = input.prompt_input.query;
    const executor_query = typeof query === "string"
      ? query
      : extractTextFromParts(query);
    this.active_run_context = run_context;
    this.request_active_history_reload = () => {
      history_reload_requested = true;
    };

    let result: SessionRunResult;
    try {
      result = await this.executor.run({
        query: executor_query,
        runContext: run_context,
      });
    } finally {
      if (this.active_run_context === run_context) {
        this.active_run_context = null;
        this.request_active_history_reload = null;
      }
    }

    const final_assistant_parts = result.assistantMessage
      ? from_ui_assistant_parts(result.assistantMessage.parts)
      : [];
    const final_assistant_writer = assistant_writer_ref.current;
    if (final_assistant_writer) {
      for (const part of from_ui_assistant_parts(result.assistant_file_parts)) {
        if (part.type === "file") await final_assistant_writer.append_file_part(part);
      }
      if (input.abort_signal?.aborted) {
        await final_assistant_writer.stop();
      } else if (result.success) {
        await final_assistant_writer.complete();
      } else {
        await final_assistant_writer.fail(result.error);
      }
    } else if (result.assistantMessage && final_assistant_parts.length > 0) {
      assistant_segment_index += 1;
      const fallback_writer = await this.messages.open_assistant_message({
        turn_id: input.turn_id,
        segment_index: assistant_segment_index,
      });
      for (const part of final_assistant_parts) {
        await fallback_writer.upsert_part(part);
      }
      if (result.success) await fallback_writer.complete();
      else await fallback_writer.fail(result.error);
    }

    if (!result.success && !input.abort_signal?.aborted && result.error) {
      await this.messages.append_error_message({
        scope: "turn",
        turn_id: input.turn_id,
        code: "turn_execution_failed",
        message: result.error,
        recoverable: true,
      });
    }
    await this.state.touch_metadata();
    const deferred_count = await this.messages.append_deferred_user_messages(
      result.deferredPersistedUserMessages,
    );
    if (deferred_count > 0) await this.state.touch_metadata();
    if (result.compact_required) {
      await this.executor.compact_history(run_context);
    }
    return {
      text: result.assistantMessage
        ? extractTextFromUiMessage(result.assistantMessage)
        : "",
      success: result.success,
      ...(result.assistantMessage
        ? { assistantMessage: result.assistantMessage }
        : {}),
      ...(result.error ? { error: result.error } : {}),
    };
  }

  /** 为 Turn 开始前的 compact 命令创建最小运行上下文。 */
  private create_compaction_run_context(turn_id: string): SessionRunContext {
    return {
      turnId: turn_id,
      sessionId: this.session_id,
      projectRoot: this.workspace_path,
      onActionCallback: async (event) => {
        await this.persist_action_event(event);
      },
      injectedUserMessages: [],
      deferredPersistedUserMessages: [],
      pendingAssistantFileParts: [],
    };
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
    await this.state.ensure_title_from_history({ generate: true });
    await this.state.touch_metadata();
    return message;
  }

  /** 持久化 Executor Action，并同步刷新 Session metadata。 */
  private async persist_action_event(
    event: SessionActionRecordV1,
  ): Promise<void> {
    await this.messages.persist_action_record(event);
    await this.state.touch_metadata();
  }
}

/** 判断 UI stream chunk 是否属于 Assistant 可持久化内容。 */
function is_assistant_content_chunk(type: string): boolean {
  return (
    type === "text-start" ||
    type === "text-delta" ||
    type === "text-end" ||
    type === "reasoning-start" ||
    type === "reasoning-delta" ||
    type === "reasoning-end" ||
    type.startsWith("tool-") ||
    type === "file" ||
    type === "source-url" ||
    type === "source-document" ||
    type === "start-step" ||
    type.startsWith("data-")
  );
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
    abort_controller: new AbortController(),
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
