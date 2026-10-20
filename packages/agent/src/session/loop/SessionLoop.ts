/**
 * SessionLoop：Session Command Queue 的唯一消费者与 Turn 生命周期所有者。
 *
 * 关键点（中文）
 * - Prompt 会先构造成 Session Command，再由统一 FIFO 决定进入当前或下一 Turn。
 * - 不把调度逻辑塞进 Executor；Executor 继续只负责单次执行。
 * - Queue 由 Session 持有；这里不解释配置种类，只执行出队 Command。
 */

import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { SessionAgentMessage, SessionUserMessage } from "@downcity/type";
import type { SessionActionEvent } from "@downcity/type";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type { AgentSessionStopResult } from "@/types/sdk/AgentSessionStop.js";
import type {
  AgentSessionTurnHandle,
  AgentSessionTurnResult,
} from "@/types/sdk/AgentSessionTurn.js";
import { snapshot_prompt_powers, describe_prompt_powers, prompt_power_fingerprint, set_turn_prompt_powers, clear_turn_prompt_powers } from "@/session/input/PromptPowers.js";
import { is_agent_session_prompt_input_empty } from "@/types/sdk/AgentSessionPrompt.js";
import type { SessionStepExecutionInput, SessionTurnExecutionResult } from "@/types/session/SessionExecution.js";
import {
  is_provider_context_limit_error,
  SessionExecutor,
  type SessionExecutorPort,
} from "@/session/runner/SessionExecutor.js";
import type { StepInput } from "@/session/input/StepInput.js";
import type { SessionTurnContext } from "@/types/turn/SessionTurnContext.js";
import { create_session_turn_context } from "@/session/loop/SessionTurnContext.js";
import { SessionEventHub } from "@/session/messages/SessionEventHub.js";
import { SessionState } from "@/session/loop/SessionState.js";
import {
  normalize_session_user_parts,
  SessionMessages,
} from "@/session/messages/SessionMessages.js";
import type {
  SessionInteractionLifecycle,
  SessionInteractionPort,
} from "@downcity/type";
import { SessionAssistantOutputAdapter } from "@/session/messages/SessionAssistantOutputAdapter.js";
import { SessionQueue } from "@/session/loop/SessionQueue.js";
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
import { create_session_model_request_warning } from "@/session/messages/SessionModelRequestWarning.js";
import {
  complete_session_turn,
  fail_session_turn,
  TURN_STOPPED_MESSAGE,
} from "@/session/loop/SessionTurnCompletion.js";
import {
  append_session_turn_file_diff,
  publish_session_turn_file_diff,
} from "@/session/loop/SessionTurnFileDiff.js";
import type { SessionTurnCompletionOptions } from "@/types/session/SessionTurnCompletion.js";

import { SessionBusyError } from "@/session/SessionBusyError.js";
import { CompletionPersistenceError, prepare_session_completion } from "./SessionCompletionJournal.js";

const QUEUED_PROMPT_CANCELLED_MESSAGE =
  "Prompt cancelled because session was stopped";

/**
 * Session 输入队列与 Turn 编排器。
 */
export class SessionLoop {
  private readonly session_id: string;
  /** 由 Agent 提供的写前日志，失败不能通过普通 Hook 吞掉。 */
  private readonly completions: SessionLoopOptions["completions"];
  private readonly session_origin: SessionLoopOptions["session_origin"];
  /** 当前 Session 的目录解析器。 */
  private readonly get_workspace_path: SessionLoopOptions["get_workspace_path"];
  private readonly step_input: StepInput | null;
  private readonly session_executor: SessionExecutorPort;
  private readonly maintain_context: SessionLoopOptions["maintain_context"];
  private readonly state: SessionState;
  private readonly messages: SessionMessages;
  private readonly events: SessionEventHub;
  private readonly logger: SessionLoopOptions["logger"];
  /** 读取当前生效的扩展处理器集合。 */
  private readonly get_hooks: SessionLoopOptions["get_hooks"];
  /** 构造当前 Turn 的调用环境快照。 */
  private readonly create_call_context: SessionLoopOptions["create_call_context"];
  private readonly interactions:
    SessionInteractionLifecycle & SessionInteractionPort;
  private readonly queue: SessionQueue;  private pending_prompt_count = 0;
  /** 队列消费的同步状态，在发布事件前设置，避免订阅回调重入启动第二个消费器。 */
  private processing = false;
  /** 同步占用，必须先于任何 await 获取，避免两个调用同时通过空闲检查。 */
  private exclusive_request: { request_id?: string; token: symbol } | null = null;
  private active_turn: ActiveSessionTurnState | null = null;
  /** 尚未完成 canonical 接收的幂等 Prompt，防止进程内并发重复入队。 */
  private readonly pending_power_fingerprints = new Map<string, string | undefined>();
  private readonly pending_request_handles = new Map<string, Promise<AgentSessionTurnHandle>>();

  constructor(options: SessionLoopOptions) {
    this.session_id = String(options.session_id || "").trim();
    this.completions = options.completions;
    this.session_origin = options.session_origin;
    this.get_workspace_path = options.get_workspace_path;
    this.maintain_context = options.maintain_context;
    this.state = options.state;
    this.messages = options.messages;
    this.events = options.events;
    this.logger = options.logger;
    this.get_hooks = options.get_hooks;
    this.create_call_context = options.create_call_context;
    this.queue = options.queue;
    this.interactions = options.interactions;
    if (!this.session_id) {
      throw new Error("SessionLoop requires a non-empty session_id");
    }
    this.step_input = options.step_input ?? null;
    this.session_executor = options.executor ??
      new SessionExecutor({
        session_id: this.session_id,
        logger: this.logger,
        is_context_limit: is_provider_context_limit_error,
        advance_context: options.advance_context,
      });
  }

  /** 覆盖占用、等待执行和收口阶段，供归档边界同步校验。 */
  is_busy(): boolean {
    return this.exclusive_request !== null || this.active_turn !== null || this.pending_prompt_count > 0 || this.processing;
  }

  /** 返回当前 Session 是否正在执行模型请求。 */
  is_executing(): boolean {
    return this.session_executor.is_executing();
  }

  /**
   * 追加一条新的 prompt。
   */
  async prompt(input: AgentSessionPromptInput): Promise<AgentSessionTurnHandle> {
    if (input.powers?.length) {
      if (input.mode === "send") throw new Error("Prompt Powers require exclusive mode");
      input = { ...input, powers: snapshot_prompt_powers(input.powers) };
    }
    if (input.callback) {
      if (!input.request_id?.trim()) throw new Error("Session callback requires request_id");
      if (!this.completions) throw new Error("Session callbacks require an Agent completion runtime");
      this.completions.validate_callback(input.callback.name);
      // JSON 数据先校验再占用，不接受无法重启恢复的函数或循环引用。
      const data = z.json().parse(input.callback.data ?? null);
      input = { ...input, callback: { name: input.callback.name, data: structuredClone(data) } };
    }
    if (input.mode === "send") return await this.submit_prompt(input);
    const request_id = input.request_id?.trim();
    // 终态已保存时允许 callback 接续新工作，队列仍在上一轮释放后串行执行。
    if (this.active_turn?.result) this.exclusive_request = null;
    if (this.exclusive_request) {
      if (!request_id || request_id !== this.exclusive_request.request_id) throw new SessionBusyError(this.session_id);
      return await this.submit_prompt(input);
    }
    if ((this.active_turn && !this.active_turn.result) || this.pending_prompt_count > 0) throw new SessionBusyError(this.session_id);
    const token = Symbol("session_execution");
    this.exclusive_request = { request_id, token };
    const release = () => {
      if (this.exclusive_request?.token === token) this.exclusive_request = null;
    };
    try {
      const handle = await this.submit_prompt(input);
      void handle.finished.then(release, release);
      return handle;
    } catch (error) { release(); throw error; }
  }

  /** 已取得占用或显式 send 的请求沿用幂等接收和 Session 队列。 */
  private async submit_prompt(input: AgentSessionPromptInput): Promise<AgentSessionTurnHandle> {
    if (is_agent_session_prompt_input_empty(input)) {
      throw new Error("session.prompt requires a non-empty query");
    }
    await this.state.ensure_runnable();
    const request_identity = resolve_prompt_request_identity(this.session_id, input.request_id);
    if (!request_identity) return await this.enqueue_prompt(input);
    const pending_handle = this.pending_request_handles.get(request_identity.turn_id);
    const fingerprint = input.powers?.length ? prompt_power_fingerprint(input) : undefined;
    if (pending_handle) {
      if (this.pending_power_fingerprints.get(request_identity.turn_id) !== fingerprint) throw new Error("request_id already belongs to different Prompt Powers or query");
      return await pending_handle;
    }
    this.pending_power_fingerprints.set(request_identity.turn_id, fingerprint);
    const operation = this.prompt_with_identity(input, request_identity);
    this.pending_request_handles.set(request_identity.turn_id, operation);
    try {
      return await operation;
    } finally {
      if (this.pending_request_handles.get(request_identity.turn_id) === operation) {
        this.pending_request_handles.delete(request_identity.turn_id);
        this.pending_power_fingerprints.delete(request_identity.turn_id);
      }
    }
  }

  /** 解析已有幂等结果，或把同一个稳定 Prompt 加入队列。 */
  private async prompt_with_identity(
    input: AgentSessionPromptInput,
    request_identity: PromptRequestIdentity,
  ): Promise<AgentSessionTurnHandle> {
    const previous = await this.messages.read_message(request_identity.message_id);
    if (previous?.role === "user") {
      const power_part = previous.parts.find((part) => part.type === "data" && part.data_type === "prompt_powers");
      const previous_powers = power_part?.type === "data" ? power_part.data : [];
      const fingerprint = previous.parts.find((part) => part.type === "data" && part.data_type === "prompt_power_fingerprint");
      if (fingerprint?.type === "data" && fingerprint.data !== prompt_power_fingerprint(input)) throw new Error("request_id already belongs to a different Prompt query");
      if (!isDeepStrictEqual(previous_powers, describe_prompt_powers(input.powers ?? []))) {
        throw new Error("request_id already belongs to different Prompt Powers");
      }
    }
    if (input.callback) {
      const existing = previous;
      const binding = existing?.role === "user" ? existing.parts.find((part) => part.type === "data" && part.data_type === "session_callback") : undefined;
      if (existing && (!binding || binding.type !== "data" || !isDeepStrictEqual(binding.data, {
        name: input.callback.name, data: input.callback.data ?? null, request_id: input.request_id,
      }))) throw new Error("request_id already belongs to a different callback configuration");
    }
    const existing_handle = await this.resolve_idempotent_prompt(request_identity);
    if (existing_handle) return existing_handle;
    const persisted_message = await this.messages.read_message(request_identity.message_id);
    // 已丢失执行方的请求只能失败收口，不允许通过重试接管未知副作用。
    const lost_powers = persisted_message?.role === "user" && persisted_message.parts.some((part) => part.type === "data" && part.data_type === "prompt_powers");
    // 稳定身份属于输入；检查点合并可能把它绑定到另一条实际 Turn。
    return await this.enqueue_prompt(lost_powers ? { ...input, powers: undefined } : input, persisted_message?.role === "user"
      ? { ...request_identity, turn_id: persisted_message.turn_id ?? request_identity.turn_id }
      : request_identity, persisted_message?.role === "user" ? persisted_message : undefined);
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
        // 幂等输入尚未写入 canonical history 时，取消代表提交失败。
        // 明确拒绝使调用方保留待投递记录，避免把合成取消句柄当作接受回执。
        if (request_identity) deferred_handle.reject(new Error(QUEUED_PROMPT_CANCELLED_MESSAGE));
        else this.resolve_cancelled_prompt(deferred_handle);
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
    return this.processing || this.has_pending_command();
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
    if (this.processing) return;
    this.processing = true;
    this.publish_runtime("running");
    void this.process_loop().finally(() => {
      this.processing = false;
      if (this.has_pending_command()) {
        this.ensure_processing();
      } else {
        this.publish_runtime("idle");
      }
    });
  }

  /** 队列状态是 Session 忙碌的唯一来源；维护命令与 prompt 共用生命周期。 */
  private publish_runtime(state: "running" | "idle"): void {
    this.events.publish({
      mutation_id: nanoid(),
      variant: "session",
      type: "runtime",
      session_id: this.session_id,
      state,
      created_at: Date.now(),
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

  /**
   * 在 Turn 收口前抽干尚未处理的 Maintenance Command。
   *
   * 关键点（中文）
   * - 收尾窗口内到达的配置变更 Action 借此与当前 Agent Message 共享同一条 Message。
   * - 只抽 Maintenance；Prompt 继续留在 FIFO 里由下一 Turn 消费。
   */
  private async drain_queued_maintenance_commands(): Promise<void> {
    const drained = this.queue.drain_maintenance();
    for (let index = 0; index < drained.length; index += 1) {
      const command = drained[index];
      try {
        await this.execute_command(command);
      } catch {
        // 失败时保留尚未处理的 Maintenance；Action 自己负责失败观测。
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
      try {
        const message = persisted_message || await this.persist_prompt_message(
          input,
          active_turn.turn_id,
          message_id,
        );
        active_turn.turn_context?.input.observe_user_message(message);
        this.pending_prompt_count = Math.max(0, this.pending_prompt_count - 1);
        deferred_handle.resolve(create_turn_handle(active_turn));
      } catch (error) {
        if (!message_id) throw error;
        // 幂等 steer 提交失败由调用方重试，不在队列中保留失效的接受 Promise。
        this.pending_prompt_count = Math.max(0, this.pending_prompt_count - 1);
        deferred_handle.reject(error);
      }
      return;
    }

    if (active_turn.turn_context && input.powers?.length) {
      set_turn_prompt_powers(active_turn.turn_context, input.powers);
    }
    active_turn.prompt_started = true;
    this.pending_prompt_count = Math.max(0, this.pending_prompt_count - 1);
    let handle_resolved = false;
    try {
      if (persisted_message?.parts.some((part) => part.type === "data" && part.data_type === "prompt_powers")) {
        throw new Error("Caller Power execution was interrupted; automatic replay is unavailable");
      }
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
      // 幂等输入尚未入库时拒绝提交，调用方可以保留原请求重试。
      // 普通交互输入继续返回可观察的失败 Turn。
      if (!handle_resolved) {
        if (message_id) deferred_handle.reject(error);
        else deferred_handle.resolve(create_turn_handle(active_turn));
      }
      await this.fail_active_turn(active_turn, error);
    } finally {
      if (active_turn.turn_context) clear_turn_prompt_powers(active_turn.turn_context);
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
    if (error instanceof CompletionPersistenceError) {
      if (this.active_turn === active_turn) this.active_turn = null;
      active_turn.deferred_finished.reject(error);
      await active_turn.turn_context?.lifecycle.dispose();
      return;
    }
    let final_result: AgentSessionTurnResult;
    try {
      const prepared = await this.completions?.read(this.session_id, active_turn.turn_id);
      final_result = prepared
        ? await complete_session_turn(this.turn_completion_options(), active_turn, prepared.result)
        : await fail_session_turn(this.turn_completion_options(), active_turn, error);
    } catch (failure) {
      if (this.active_turn === active_turn) this.active_turn = null;
      active_turn.deferred_finished.reject(failure);
      await active_turn.turn_context?.lifecycle.dispose();
      return;
    }
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
      result = await this.run_turn_with_context_advance(turn_context);
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
        code: result.error_code || "turn_execution_failed",
        message: result.error,
        recoverable: true,
      });
    }

    await append_session_turn_file_diff({
      session_id: this.session_id,
      turn_id: input.active_turn.turn_id,
      workspace_path: this.get_workspace_path(),
      turn_context,
      assistant_output,
      logger: this.logger,
    });

    await this.drain_queued_maintenance_commands();

    await prepare_session_completion(this.turn_completion_options(), input.active_turn, {
      turn_id: input.active_turn.turn_id,
      text: result.text,
      success: result.success,
      ...(result.error ? { error: result.error } : {}),
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

  /**
   * 执行 Turn；上下文推进与重试由执行器内部负责。
   *
   * 关键点（中文）：每次重试都重新装配 Step 输入，保证读到刚推进的上下文。
   */
  private async run_turn_with_context_advance(
    turn_context: SessionTurnContext,
  ): Promise<SessionTurnExecutionResult> {
    return await this.session_executor.execute({
      turn_context,
      resolve_step_input: async (advance_count) =>
        await this.require_step_input(turn_context, advance_count),
    });
  }

  /**
   * 解析当前 Step 的输入。
   *
   * 关键点（中文）：注入执行器时本 Loop 不拥有输入装配能力；回调一旦被调用即说明注入契约
   * 被破坏，因此直接报错而不是静默返回空输入。
   */
  private async require_step_input(
    turn_context: SessionTurnContext,
    advance_count: number,
  ): Promise<SessionStepExecutionInput> {
    const step_input = this.step_input;
    if (!step_input) {
      throw new Error(
        "SessionLoop was given an executor and cannot assemble step input",
      );
    }
    return await step_input.build(turn_context, advance_count);
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
      project_root: this.get_workspace_path(),
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
      interactions: this.interactions,
      on_effects_changed: (effects) => {
        publish_session_turn_file_diff({
          session_id: this.session_id,
          turn_id: active_turn.turn_id,
          workspace_path: this.get_workspace_path(),
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
      project_root: this.get_workspace_path(),
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
    const existing_message = await this.messages.read_message(identity.message_id);
    if (!existing_message) return null;
    if (existing_message.role !== "user" || !existing_message.turn_id) {
      throw new Error("Session prompt request identity conflicts with canonical history");
    }
    const actual_turn_id = existing_message.turn_id;
    if (this.active_turn?.turn_id === actual_turn_id) {
      return create_turn_handle(this.active_turn);
    }
    const prepared = await this.completions?.read(this.session_id, actual_turn_id);
    if (prepared) return create_completed_turn_handle({ turn_id: actual_turn_id, ...prepared.result });
    const agent_message = await this.messages.read_latest_agent_message(actual_turn_id);
    if (!agent_message || agent_message.state === "streaming") return null;
    return create_completed_turn_handle(to_persisted_turn_result(actual_turn_id, agent_message));
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
      completions: this.completions,
      session_id: this.session_id,
      messages: this.messages,
      events: this.events,
      logger: this.logger,
      stopped_message: TURN_STOPPED_MESSAGE,
      get_hooks: this.get_hooks,
      create_call_context: this.create_call_context,
    };
  }
}

/** 为输入接受和 Turn 完成创建独立的 Promise 控制器。 */
function create_deferred<T>(): SessionDeferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((inner_resolve, inner_reject) => {
    resolve = inner_resolve;
    reject = inner_reject;
  });
  return { promise, resolve, reject };
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
