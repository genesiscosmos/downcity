/**
 * SDK 本地 Session 封装。
 *
 * 关键点（中文）
 * - 面向 `new Agent(...)` 的本地会话使用场景。
 * - 对外保留稳定 Session facade，把状态、turn、view 逻辑下沉到独立 service。
 * - 内部使用 `SessionMessages` 统一管理 Active、Segment 与流式 Assistant 草稿。
 */

import { Executor } from "@executor/Executor.js";
import type { LanguageModel, Tool } from "ai";
import {
  infer_agent_model_label,
  normalize_agent_model,
  read_agent_model_context_window,
  type AgentModel,
} from "@/agent/AgentModel.js";
import { SessionMessages } from "@/session/SessionMessages.js";
import type {
  AgentSessionConfigSnapshot,
  AgentSessionForkInput,
  AgentSessionInfo,
  AgentSessionStatus,
  AgentSessionSetInput,
  AgentSessionSetOptions,
  AgentSessionSystemBlock,
  AgentSessionSystemSnapshot,
} from "@/types/agent/SessionTypes.js";
import type { AgentSession } from "@/types/agent/SessionActor.js";
import { resolve_system_timezone } from "@/session/storage/Metadata.js";
import { create_runtime_session_port } from "@/session/storage/RuntimeSessionPort.js";
import type { SessionPort } from "@/types/session/SessionPort.js";
import type { SessionMutationSubscriber, SessionMutationUnsubscribe } from "@/types/session/SessionMutation.js";
import type {
  RespondSessionInteractionInput,
  SessionApprovalMode,
  SessionInteractionResult,
  SessionPendingInteraction,
} from "@/types/session/SessionInteraction.js";
import type { ListSessionMessagesInput, SessionMessagePage } from "@/types/session/SessionMessage.js";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type { AgentSessionStopResult } from "@/types/sdk/AgentSessionStop.js";
import type { AgentSessionCompactHandle } from "@/types/sdk/AgentSessionCompact.js";
import type { AgentSessionTurnHandle } from "@/types/sdk/AgentSessionTurn.js";
import { SessionEventHub } from "@/session/runtime/SessionEventHub.js";
import { create_session_compact_operation } from "@/session/runtime/SessionCompactOperation.js";
import { run_session_history_compaction } from "@/session/runtime/SessionHistoryCompaction.js";
import { create_session_plugin_execution_context } from "@/session/runtime/SessionTurnContext.js";
import { SessionState } from "@/session/SessionState.js";
import { SessionLoop } from "@/session/SessionLoop.js";
import { SessionQueue } from "@/session/SessionQueue.js";
import { SessionCommand } from "@/session/SessionCommand.js";
import type { SessionLocalState } from "@/types/session/SessionLocalState.js";
import type { SessionOptions } from "@/types/session/SessionOptions.js";
import type { AgentPluginExecutionRuntime } from "@/types/plugin/PluginRuntime.js";
import { SessionInteractions } from "@/session/control/SessionInteractions.js";
import { SessionShellApprovalAdapter } from "@/session/execution/tools/SessionShellApprovalAdapter.js";
import { DefaultSessionComposer } from "@/session/DefaultSessionComposer.js";
import type {
  SessionComposer,
  SessionComposeIdentity,
  SessionCompactionPlan,
  SessionComposeInput,
  SessionStepInput,
} from "@/types/session/SessionComposer.js";
import type { SessionCompactHistory } from "@/types/session/SessionExecution.js";
import type { SessionTurnContext } from "@/types/executor/SessionTurnContext.js";
import { generate_id } from "@/utils/Id.js";
import { nanoid } from "nanoid";
import { build_session_info } from "@/session/browse/Browse.js";
import { ensure_session_title } from "@/session/SessionTitle.js";
import { to_executor_history } from "@/session/messages/SessionMessageCodec.js";
import type { SessionMessage } from "@/types/session/SessionMessage.js";
import type { SessionActionRecordInputV1 } from "@/executor/types/SessionRecords.js";
import type { SessionCommandOptions } from "@/types/session/SessionCommand.js";
import type { SessionDataStore } from "@/types/store/SessionDataStore.js";

/**
 * SDK 本地 Session。
 */
export class Session implements AgentSession {
  readonly id: string;
  readonly agent_id: string;

  private readonly workspace_path: string;
  private readonly store: SessionDataStore;
  private readonly get_session_store: SessionOptions["get_session_store"];
  private readonly tools: Record<string, Tool>;
  private readonly logger: SessionOptions["logger"];
  private readonly get_managed_plugin_system_blocks: SessionOptions["get_managed_plugin_system_blocks"];
  private readonly ensure_configured_hook?: SessionOptions["ensure_configured"];
  private readonly composer: SessionComposer;
  private readonly session_messages: SessionMessages;
  private readonly executor: Executor;
  private readonly events: SessionEventHub;
  private readonly session_interactions: SessionInteractions;
  private readonly shell_approval_adapter: SessionShellApprovalAdapter;
  private readonly local_state: SessionLocalState;
  private readonly get_workspace_env: SessionOptions["get_workspace_env"];
  private readonly get_agent_model: SessionOptions["get_agent_model"];
  private readonly get_agent_plugins: SessionOptions["get_agent_plugins"];
  private readonly get_instruction_system_blocks:
    SessionOptions["get_instruction_system_blocks"];
  private effective_instruction_system_blocks: AgentSessionSystemBlock[];
  /** 当前 Session 的一次性初始化任务，避免缓存实例被重复恢复运行时状态。 */
  private initialize_promise: Promise<void> | null = null;
  private instruction_initialize_promise: Promise<void> | null = null;
  private effective_workspace_env: Record<string, string>;
  private effective_agent_plugins: AgentPluginExecutionRuntime;
  /** 当前 Session 首次生成后固定的完整 system snapshot。 */
  private system_snapshot_blocks: AgentSessionSystemBlock[] | null = null;
  /** 串行化 snapshot / syncshot 对 system 与 instruction.md 的修改。 */
  private system_mutation_chain: Promise<void> = Promise.resolve();
  private readonly state: SessionState;
  /** 当前 Session 独享的 Command FIFO。 */
  private readonly session_queue = new SessionQueue();
  private readonly session_loop: SessionLoop;
  private runtime_port: SessionPort | null = null;

  constructor(options: SessionOptions) {
    this.id = String(options.session_id || "").trim();
    this.agent_id = String(options.agent_id || "").trim();
    this.workspace_path = String(options.workspace_path || "").trim();
    this.store = options.store;
    this.get_session_store = options.get_session_store;
    this.tools = options.tools;
    this.logger = options.logger;
    this.get_workspace_env = options.get_workspace_env;
    this.get_agent_model = options.get_agent_model;
    this.get_agent_plugins = options.get_agent_plugins;
    this.get_instruction_system_blocks = options.get_instruction_system_blocks;
    this.effective_instruction_system_blocks = options
      .instruction_system_blocks
      .map((block) => ({ ...block }));
    this.effective_workspace_env = { ...options.get_workspace_env() };
    this.effective_agent_plugins = options.get_agent_plugins();
    this.get_managed_plugin_system_blocks = options.get_managed_plugin_system_blocks;
    this.ensure_configured_hook = options.ensure_configured;
    this.composer = options.composer || new DefaultSessionComposer();
    if (!this.id) {
      throw new Error("Session requires a non-empty session_id");
    }
    if (!this.agent_id) {
      throw new Error("Session requires a non-empty agent_id");
    }
    if (!this.workspace_path) {
      throw new Error("Session requires a non-empty workspace_path");
    }

    this.events = new SessionEventHub();
    this.session_messages = new SessionMessages({
      session_id: this.id,
      store: this.store.messages,
      attachment_store: this.store.attachments,
      publish: (mutation) => {
        this.events.publish(mutation);
      },
    });
    this.session_interactions = new SessionInteractions({
      session_id: this.id,
      messages: this.session_messages,
    });
    this.shell_approval_adapter = new SessionShellApprovalAdapter({
      session_id: this.id,
      interactions: this.session_interactions,
    });
    this.local_state = this.create_local_state();
    this.executor = this.create_executor();
    this.state = new SessionState({
      agent_id: this.agent_id,
      session_id: this.id,
      store: this.store,
      messages: this.session_messages,
      state: this.local_state,
      logger: this.logger,
      ensure_configured_hook: this.ensure_configured_hook
        ? async () => {
            await this.ensure_configured_hook?.(this);
          }
        : undefined,
      get_model: () => this.get_model(),
      publish_event: (event) => {
        this.events.publish(event);
      },
    });
    this.session_loop = new SessionLoop({
      session_id: this.id,
      workspace_path: this.workspace_path,
      executor: this.executor,
      compact_history: async (input) => await this.compact_history(input),
      state: this.state,
      events: this.events,
      logger: this.logger,
      messages: this.session_messages,
      interactions: this.session_interactions,
      shell_approval_gateway: this.shell_approval_adapter,
      queue: this.session_queue,
    });
  }

  /**
   * 初始化当前 session。
   */
  async initialize(): Promise<this> {
    if (!this.initialize_promise) {
      this.initialize_promise = (async () => {
        await Promise.all([
          this.initialize_instruction(),
          this.session_messages.initialize(),
          this.state.initialize(),
        ]);
        this.shell_approval_adapter.set_effective_mode(
          this.state.get_approval_mode(),
        );
      })();
    }
    await this.initialize_promise;
    return this;
  }

  /**
   * 把当前 Session 首次生成后固定的完整 system 显式固化到 instruction.md。
   *
   * 关键点（中文）
   * - 包含 instruction、SDK core、plugin system 与 Session context。
   * - 多个 system block 按原顺序合并为一个 Markdown 文档。
   */
  async snapshot(): Promise<void> {
    await this.run_system_mutation(async () => {
      const system_snapshot = await this.system();
      await this.write_system_snapshot(system_snapshot.blocks);
    });
  }

  /**
   * 使用 Agent 当前 instruction 与 plugin 重新生成一次完整 system。
   *
   * 关键点（中文）
   * - 只替换内存 snapshot，不改变 plugin execution view。
   * - instruction.md 已存在时同步覆盖；不存在时不自动创建。
   * - 当前已经发出的 provider 请求不受影响，后续 step 使用新 snapshot。
   */
  async syncshot(): Promise<void> {
    await this.run_system_mutation(async () => {
      await this.initialize_instruction();
      const should_persist = await this.store.has_instruction();
      const composed = await this.composer.compose(
        await this.create_compose_input(undefined, 0, true),
      );
      const next_blocks = resolve_composed_system_blocks(composed);

      if (should_persist) {
        await this.write_system_snapshot(next_blocks);
      }
      this.effective_instruction_system_blocks =
        this.get_instruction_system_blocks().map((block) => ({ ...block }));
      this.system_snapshot_blocks = next_blocks;
    });
  }

  /**
   * 读取当前 session 配置快照。
   */
  get config(): AgentSessionConfigSnapshot {
    return this.state.get_config();
  }

  /**
   * 写入当前 session 默认配置。
   */
  async set(
    input: AgentSessionSetInput,
    options?: AgentSessionSetOptions,
  ): Promise<void> {
    if (!input.model && !input.security) {
      throw new Error("session.set requires model or security");
    }
    const requested_approval_mode = input.security?.approval_mode;
    if (
      requested_approval_mode !== undefined &&
      requested_approval_mode !== "ask" &&
      requested_approval_mode !== "always-allow"
    ) {
      throw new Error("security.approval_mode must be ask or always-allow");
    }
    const persist_action = options?.persist_action !== false;
    const publish_mutation =
      options?.publish_mutation === undefined
        ? persist_action
        : options.publish_mutation;
    if (!persist_action && publish_mutation) {
      throw new Error(
        "session.set publish_mutation requires persist_action",
      );
    }
    const model_result = input.model
      ? await this.state.set_model(input.model)
      : undefined;
    const next_approval_mode = requested_approval_mode;
    const security_changed = next_approval_mode !== undefined
      ? await this.state.set_approval_mode(next_approval_mode)
      : false;
    if (!model_result && !security_changed) return;
    if (model_result?.changed && publish_mutation) {
      this.events.publish({
        mutation_id: generate_id(),
        variant: "session",
        type: "config",
        session_id: this.id,
        created_at: Date.now(),
        ...(model_result.config.model_label
          ? { model_label: model_result.config.model_label }
          : {}),
        ...(typeof model_result.config.model_context_window === "number"
          ? { model_context_window: model_result.config.model_context_window }
          : {}),
      });
    }
    const changed_fields = [
      ...(model_result?.changed
        ? [`model: ${String(model_result.config.model_label || "configured")}`]
        : []),
      ...(security_changed
        ? [`security.approval_mode: ${String(next_approval_mode)}`]
        : []),
    ];
    const completion = changed_fields.length > 0 && persist_action
      ? {
          type: "action" as const,
          id: `session-config:${this.id}:${Date.now()}:${generate_id()}`,
          title: "Session configuration updated",
          description: changed_fields.join("; "),
          publish_mutation,
        }
      : undefined;
    this.enqueue_command({
      execute: async () => {
        if (model_result) this.state.apply_model_config(model_result.config);
        if (security_changed && next_approval_mode) {
          this.shell_approval_adapter.set_effective_mode(next_approval_mode);
        }
      },
      ...(completion ? { completion } : {}),
    });
  }

  /**
   * 追加一条新的 Session prompt。
   */
  async prompt(input: AgentSessionPromptInput): Promise<AgentSessionTurnHandle> {
    await this.initialize_instruction();
    return await this.session_loop.prompt(input);
  }

  /**
   * 停止当前 turn，并取消尚未被吸收的排队 prompt。
   */
  async stop(): Promise<AgentSessionStopResult> {
    return await this.session_loop.stop();
  }

  /**
   * 把一次显式历史压缩加入当前 Session 的有序输入队列。
   */
  async compact(): Promise<AgentSessionCompactHandle> {
    await this.state.ensure_runnable();
    const compact_id = `compact:${this.id}:${generate_id()}`;
    const operation = create_session_compact_operation({
      compact_id,
      run: async () => await this.session_loop.compact_history(compact_id),
      log_error: async (error_message) => {
        await this.logger.log("warn", "[agent] session compact command failed", {
          session_id: this.id,
          compact_id,
          error: error_message,
        });
      },
      publish_finish: (final_result) => {
        this.events.publish({
          mutation_id: nanoid(),
          variant: "compact",
          type: "finish",
          session_id: this.id,
          compact_id,
          status: final_result.success ? "completed" : "failed",
          compacted: final_result.compacted,
          reason: final_result.reason,
          created_at: Date.now(),
          ...(final_result.error ? { error: final_result.error } : {}),
        });
      },
    });
    this.enqueue_command({
      execute: operation.execute,
    });
    this.events.publish({
      mutation_id: nanoid(),
      variant: "compact",
      type: "start",
      session_id: this.id,
      compact_id,
      status: "queued",
      created_at: Date.now(),
    });
    return operation.handle;
  }

  /** 把 Workspace env 快照加入当前 Session 的有序输入队列。 */
  enqueue_workspace_env(input: {
    /** 当前 Workspace env 修改的稳定标识。 */
    command_id: string;
    /** 下一 Session Step 使用的完整环境变量快照。 */
    env: Record<string, string>;
  }): void {
    this.enqueue_command({
      execute: async () => {
        this.effective_workspace_env = { ...input.env };
      },
      completion: {
        type: "action",
        id: `agent-env:${this.id}:${input.command_id}`,
        title: "Workspace environment updated",
      },
    });
  }

  /** 把 Agent Plugin 执行视图加入当前 Session 的有序输入队列。 */
  enqueue_agent_plugins(input: {
    /** 当前 Plugin 修改的稳定标识。 */
    command_id: string;
    /** 当前 Plugin 修改的用户可读标题。 */
    title: string;
    /** 下一 Session Step 使用的 Plugin 执行视图。 */
    plugins: AgentPluginExecutionRuntime;
  }): void {
    this.enqueue_command({
      execute: async () => {
        this.effective_agent_plugins = input.plugins;
      },
      completion: {
        type: "action",
        id: `agent-plugins:${this.id}:${input.command_id}`,
        title: input.title,
      },
    });
  }

  /** 创建一个具体 Session Command 对象并加入当前 FIFO。 */
  private enqueue_command(options: SessionCommandOptions): void {
    this.session_queue.enqueue_command(new SessionCommand(options));
  }

  /**
   * 订阅当前 Session 的未来事件。
   */
  subscribe(
    subscriber: SessionMutationSubscriber,
  ): SessionMutationUnsubscribe {
    return this.events.subscribe(subscriber);
  }

  /** 列出当前 Session 正在等待用户响应的 Interaction。 */
  async interactions(): Promise<SessionPendingInteraction[]> {
    return this.session_interactions.list();
  }

  /** 读取当前 Session 的运行与安全状态。 */
  async status(): Promise<AgentSessionStatus> {
    const active_turn_id = this.session_loop.current_turn_id();
    return {
      session_id: this.id,
      state: active_turn_id || this.executor.is_executing() ? "running" : "idle",
      ...(active_turn_id ? { active_turn_id } : {}),
      security: {
        approval_mode: this.state.get_approval_mode(),
        effective_approval_mode: this.shell_approval_adapter.get_effective_mode(),
      },
    };
  }

  /** 提交当前 Session 的 Interaction 用户响应。 */
  async respond(input: RespondSessionInteractionInput): Promise<SessionInteractionResult> {
    return await this.session_interactions.respond(input);
  }

  /**
   * 追加一条 user 文本消息。
   */
  async append_user_message(input: {
    text: string;
  }): Promise<void> {
    const appended = await this.session_messages.append_external_user_message({
      text: String(input.text || "").trim(),
    });
    if (!appended) return;
    this.state.touch_metadata_in_background();
    this.state.schedule_title_generation();
  }

  /**
   * 追加一条 assistant 文本消息。
   */
  async append_assistant_message(input: {
    text: string;
  }): Promise<void> {
    const appended = await this.session_messages.append_external_assistant_message({
      fallback_text: String(input.text || "").trim(),
    });
    if (appended) await this.state.touch_metadata();
  }

  /**
   * 读取当前 session 详情。
   */
  async get_info(): Promise<AgentSessionInfo> {
    const [metadata, snapshot] = await Promise.all([
      this.store.read_metadata(),
      this.session_messages.context_snapshot(),
    ]);
    const records = to_executor_history(this.id, snapshot);
    const metadata_with_title = metadata.title
      ? metadata
      : await ensure_session_title({
          session_id: this.id,
          store: this.store,
          messages: records,
          logger: this.logger,
        });
    const model_label = String(
      metadata_with_title.model_label ||
      infer_agent_model_label(this.get_selected_model()) ||
      "",
    ).trim();
    return build_session_info({
      project_root: this.workspace_path,
      agent_id: this.agent_id,
      session_id: this.id,
      metadata: {
        ...metadata_with_title,
        ...(model_label ? { model_label } : {}),
      },
      messages: records,
      executing: this.is_executing(),
    });
  }

  /**
   * 读取当前 session records 分页。
   */
  async messages(input?: ListSessionMessagesInput): Promise<SessionMessagePage> {
    return await this.session_messages.list_messages(input);
  }

  /**
   * 读取当前 session 生效的 system 快照。
   */
  async system(): Promise<AgentSessionSystemSnapshot> {
    await this.initialize_instruction();
    const composed = await this.compose_for_view();
    const blocks = resolve_composed_system_blocks(composed);
    return {
      session_id: this.id,
      session: {
        agent_id: this.agent_id,
        session_id: this.id,
        project_root: this.workspace_path,
        created_at: new Date(this.state.get_created_at()).toISOString(),
        timezone: this.state.get_timezone(),
      },
      blocks,
    };
  }

  /**
   * 返回当前 session 是否正在执行。
   */
  is_executing(): boolean {
    return this.session_loop.is_active() || this.executor.is_executing();
  }

  /**
   * 从当前 session 创建一个分叉会话。
   */
  async fork(input?: AgentSessionForkInput | string): Promise<this> {
    const message_id = typeof input === "string"
      ? String(input || "").trim() || undefined
      : String(input?.message_id || "").trim() || undefined;
    const messages = await this.session_messages.list_history_messages();
    const fork_messages = message_id
      ? this.resolve_fork_messages(messages, message_id)
      : messages;
    const action_id = `history-forking:${this.id}:${Date.now()}:${nanoid(8)}`;
    await this.emit_action_event({
      id: action_id,
      title: "Forking session messages",
      description: `Preparing ${String(fork_messages.length)} messages for the new session.`,
      state: "running",
    });
    try {
      const forked = this.create_fork_session(
        `fork-${Date.now()}-${nanoid(8)}`,
      );
      await forked.initialize();
      const session_config = this.state.get_config();
      if (session_config.model) {
        const forked_model = await forked.state.set_model(session_config.model);
        forked.state.apply_model_config(forked_model.config);
      }
      const approval_mode = this.state.get_approval_mode();
      await forked.state.set_approval_mode(approval_mode);
      forked.shell_approval_adapter.set_effective_mode(approval_mode);
      await forked.session_messages.import_messages(fork_messages);
      await this.emit_action_event({
        id: action_id,
        title: "Session messages forked",
        description: `Created ${forked.id} with ${String(fork_messages.length)} messages.`,
        state: "completed",
      });
      return forked;
    } catch (error) {
      await this.emit_action_event({
        id: action_id,
        title: "Session messages fork failed",
        description: error instanceof Error ? error.message : String(error),
        state: "failed",
      });
      throw error;
    }
  }

  /** 截取 Fork 目标 Message 及其之前的完整历史。 */
  private resolve_fork_messages(
    messages: SessionMessage[],
    message_id: string,
  ): SessionMessage[] {
    const target_index = messages.findIndex(
      (message) => message.message_id === message_id,
    );
    if (target_index < 0) {
      throw new Error(
        `Cannot fork session "${this.id}": message_id "${message_id}" not found.`,
      );
    }
    return messages.slice(0, target_index + 1);
  }

  /**
   * 返回供受托管 plugin 使用的 session 端口。
   */
  get_runtime_port(): SessionPort {
    if (this.runtime_port) return this.runtime_port;
    this.runtime_port = create_runtime_session_port({
      session_id: this.id,
      get_model: () => this.get_model(),
      get_executor: () => this.executor,
      prompt: async (input) => await this.prompt(input),
      stop: async () => await this.stop(),
      subscribe: (subscriber) => this.subscribe(subscriber),
      append_user_message: async (message_params) => {
        const appended = await this.session_messages.append_external_user_message(
          message_params,
        );
        if (!appended) return;
        this.state.touch_metadata_in_background();
        this.state.schedule_title_generation();
      },
      append_assistant_message: async (message_params) => {
        const appended = await this.session_messages.append_external_assistant_message({
          message: message_params.message,
          fallback_text: message_params.fallback_text,
        });
        if (appended) await this.state.touch_metadata();
      },
      is_executing: () => this.is_executing(),
      context: async () => await this.session_messages.context_snapshot(),
      ensure_ready_for_execution: async () => {
        await this.ensure_ready_for_execution();
      },
    });
    return this.runtime_port;
  }

  /** 取消并释放当前 Session 的标题后台任务。 */
  dispose_title_generation(): void {
    this.state.dispose_title_generation();
  }

  /**
   * 在执行前确保 session 已完成初始化与宿主装配。
   */
  async ensure_ready_for_execution(): Promise<void> {
    await this.initialize_instruction();
    await this.state.ensure_ready_for_execution();
  }

  private create_fork_session(session_id: string): this {
    return this.create_child_session({
      agent_id: this.agent_id,
      workspace_path: this.workspace_path,
      store: this.get_session_store(session_id),
      get_session_store: this.get_session_store,
      session_id: session_id,
      tools: this.tools,
      logger: this.logger,
      instruction_system_blocks: this.effective_instruction_system_blocks.map(
        (block) => ({ ...block }),
      ),
      get_instruction_system_blocks: this.get_instruction_system_blocks,
      get_workspace_env: this.get_workspace_env,
      get_agent_plugins: this.get_agent_plugins,
      get_managed_plugin_system_blocks: this.get_managed_plugin_system_blocks,
      ensure_configured: this.ensure_configured_hook,
      get_agent_model: this.get_agent_model,
      composer: this.composer,
    });
  }

  /**
   * 创建当前 Session 的同类子会话。
   *
   * 关键点（中文）
   * - 默认沿用当前实例的 class，避免自定义 Session 在 fork 后退回默认实现。
   * - 子类仍可覆盖该方法，接管更特殊的子会话创建逻辑。
   */
  protected create_child_session(options: SessionOptions): this {
    const session_class = this.constructor as new (
      options: SessionOptions,
    ) => Session;
    return new session_class(options) as this;
  }

  /** 恢复显式固化的完整 system snapshot；文件不存在时等待首次生成。 */
  private async initialize_instruction(): Promise<void> {
    if (!this.instruction_initialize_promise) {
      this.instruction_initialize_promise = (async () => {
        const persisted_instruction = await this.store.read_instruction();
        if (persisted_instruction === null) return;

        const instruction = persisted_instruction.trim();
        this.system_snapshot_blocks = instruction
          ? [{
              source: "instruction" as const,
              name: "snapshot",
              content: instruction,
            }]
          : [];
        const stable_system_blocks = this.effective_instruction_system_blocks
          .filter((block) => block.source !== "instruction")
          .map((block) => ({ ...block }));
        this.effective_instruction_system_blocks = [
          ...(instruction
            ? [{
                source: "instruction" as const,
                name: "agent",
                content: instruction,
              }]
            : []),
          ...stable_system_blocks,
        ];
      })();
    }
    await this.instruction_initialize_promise;
  }

  private create_local_state(): SessionLocalState {
    return {
      session_config: {},
      effective_session_config: {},
      configured_approval_mode: "ask",
      created_at: Date.now(),
      timezone: resolve_system_timezone(),
      initialize_promise: null,
      ensure_configured_promise: null,
    };
  }

  /** 创建只依赖统一 Composer 的 Turn Executor。 */
  private create_executor(): Executor {
    return new Executor({
      session_id: this.id,
      composer: this.composer,
      get_compose_input: async (turn_context, retry_count) =>
        await this.create_compose_input(turn_context, retry_count),
      compact_history: async (input) => await this.compact_history(input),
      get_model: () => this.get_model(),
      logger: this.logger,
      get_plugins: () => this.effective_agent_plugins,
      apply_system_snapshot: (input) => this.apply_system_snapshot(input),
    });
  }

  /** 为 Composer 创建当前 Step 的只读 Session 快照。 */
  private async create_compose_input(
    turn_context: SessionTurnContext | undefined,
    retry_count: number,
    refresh_system = false,
  ): Promise<SessionComposeInput> {
    const instruction_system_blocks = refresh_system
      ? this.get_instruction_system_blocks().map((block) => ({ ...block }))
      : this.effective_instruction_system_blocks.map((block) => ({ ...block }));
    // 关键点（中文）：Plugin system 本身参与 Compose，必须先让它看到当前检查点
    // 已确定的 env 与 instruction；Executor 会在 Compose 返回后提交最终 Step 快照。
    turn_context?.step.commit({
      workspace_env: this.effective_workspace_env,
      agent_systems: instruction_system_blocks.map((block) => block.content),
    });
    const plugin_execution_context =
      turn_context?.step.plugin_execution_context() ||
      create_session_plugin_execution_context({
        session_id: this.id,
        project_root: this.workspace_path,
        workspace_env: this.effective_workspace_env,
        agent_systems: this.effective_instruction_system_blocks.map(
          (block) => block.content,
        ),
      });
    const plugin_system_blocks = this.system_snapshot_blocks && !refresh_system
      ? []
      : refresh_system
        ? await this.get_agent_plugins().system_blocks(plugin_execution_context)
        : turn_context?.step.plugins
          ? await turn_context.step.plugins.system_blocks(
              plugin_execution_context,
            )
          : await this.effective_agent_plugins.system_blocks(
              plugin_execution_context,
            );
    return {
      session: this.create_compose_identity(),
      state: {
        model: this.get_model(),
        model_context_window: this.get_model_context_window(),
        env: Object.freeze({ ...this.effective_workspace_env }),
        systems: Object.freeze(
          instruction_system_blocks.map((block) => block.content),
        ),
        tools: Object.freeze({ ...this.tools }),
        instruction_system_blocks,
        managed_plugin_system_blocks:
          this.system_snapshot_blocks && !refresh_system
            ? []
            : await this.get_managed_plugin_system_blocks(),
        plugin_system_blocks,
      },
      history: await this.session_messages.context_snapshot(),
      turn: {
        ...(turn_context
          ? { turn_id: turn_context.session.turn_id }
          : {}),
        retry_count,
      },
    };
  }

  /** 创建 Composer 共用的稳定 Session 身份快照。 */
  private create_compose_identity(): SessionComposeIdentity {
    return {
      agent_id: this.agent_id,
      session_id: this.id,
      project_root: this.workspace_path,
      created_at: this.local_state.created_at,
      timezone: this.local_state.timezone,
    };
  }

  /** 生成并提交 canonical 历史压缩；该职责不进入 Executor。 */
  private async compact_history(
    input: Parameters<SessionCompactHistory>[0],
  ): ReturnType<SessionCompactHistory> {
    return await run_session_history_compaction({
      turn_id: input.turn_id,
      create_plan: async () => await this.composer.compact({
        session: this.create_compose_identity(),
        model: this.get_model(),
        history: await this.session_messages.context_snapshot(),
      }),
      commit_plan: async (plan) => {
        await this.commit_compaction_plan(plan, input.turn_id);
      },
      log_error: async (error_message) => {
        await this.logger.log("warn", "[agent] session history compaction failed", {
          session_id: this.id,
          ...(input.turn_id ? { turn_id: input.turn_id } : {}),
          error: error_message,
        });
      },
    });
  }

  /** 使用统一 Composer 生成只读 system/history 查询结果。 */
  private async compose_for_view(): Promise<SessionStepInput> {
    const composed = await this.composer.compose(
      await this.create_compose_input(undefined, 0),
    );
    return this.apply_system_snapshot(composed);
  }

  /** 固定或应用当前 Session 的 system snapshot。 */
  private apply_system_snapshot(input: SessionStepInput): SessionStepInput {
    if (!this.system_snapshot_blocks) {
      this.system_snapshot_blocks = resolve_composed_system_blocks(input);
    }

    return {
      ...input,
      system: this.system_snapshot_blocks.map((block) => ({
        role: "system" as const,
        content: block.content,
      })),
      system_blocks: this.system_snapshot_blocks.map((block) => ({ ...block })),
    };
  }

  /** 串行执行一次 Session system 修改。 */
  private async run_system_mutation(
    operation: () => Promise<void>,
  ): Promise<void> {
    const next = this.system_mutation_chain.then(operation, operation);
    this.system_mutation_chain = next.catch(() => undefined);
    await next;
  }

  /** 把指定完整 system blocks 原子写入 instruction.md。 */
  private async write_system_snapshot(
    blocks: readonly AgentSessionSystemBlock[],
  ): Promise<void> {
    await this.store.write_instruction(
      blocks.map((block) => block.content).join("\n\n"),
    );
  }

  /** 提交 Composer 生成的 Segment 压缩计划。 */
  private async commit_compaction_plan(
    plan: SessionCompactionPlan,
    turn_id?: string,
  ): Promise<void> {
    const action_id = `compacting:${this.id}:${generate_id()}`;
    await this.emit_action_event({
      id: action_id,
      title: "Compacting session messages",
      state: "running",
      ...(turn_id
        ? { turn_id }
        : {}),
    });
    try {
      await this.session_messages.compact_active({
        through_sequence: plan.through_sequence,
        summary: plan.summary,
      });
      await this.emit_action_event({
        id: action_id,
        title: "Session messages compacted",
        description: plan.used_fallback
          ? `Closed Active through Message ${plan.boundary_message_id} with deterministic fallback Summary.`
          : `Closed Active through Message ${plan.boundary_message_id}.`,
        state: "completed",
        ...(turn_id
          ? { turn_id }
          : {}),
      });
      await this.state.touch_metadata();
    } catch (error) {
      await this.emit_action_event({
        id: action_id,
        title: "Session messages compact failed",
        description: error instanceof Error ? error.message : String(error),
        state: "failed",
        ...(turn_id
          ? { turn_id }
          : {}),
      });
      throw error;
    }
  }

  /**
   * 返回当前 Session 实际使用的模型实例。
   *
   * 解析顺序固定为 Session 覆盖模型，其次回退到 Agent 模型。
   */
  get_model(): LanguageModel | undefined {
    const model = this.get_selected_model();
    return model ? normalize_agent_model(model) : undefined;
  }

  /** 按 Session 优先、Agent 兜底规则读取当前配置的 AgentModel。 */
  private get_selected_model(): AgentModel | undefined {
    return (
      this.local_state.effective_session_config.model ||
      this.local_state.session_config.model ||
      this.get_agent_model()
    );
  }

  /** 读取当前有效模型对应的上下文窗口。 */
  private get_model_context_window(): number | undefined {
    return (
      this.local_state.effective_session_config.model_context_window ||
      this.local_state.session_config.model_context_window ||
      read_agent_model_context_window(this.get_selected_model())
    );
  }

  /** 持久化并发布一条 canonical Action Message。 */
  private async emit_action_event(input: SessionActionRecordInputV1): Promise<void> {
    const action_id = String(input.id || "").trim() ||
      `action:${this.id}:${Date.now()}`;
    await this.session_messages.persist_action_record({
      type: "action",
      id: action_id,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      state: input.state,
      metadata: {
        v: 1,
        ts: Date.now(),
        session_id: this.id,
        ...(input.turn_id ? { turn_id: input.turn_id } : {}),
      },
    });
    await this.state.touch_metadata();
  }

}

/** 把自定义 Composer 的 system content 转为可展示文本。 */
function stringify_system_content(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (content === null || content === undefined) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content || "").trim();
  }
}

/** 以实际模型输入为准，保留仍与其一致的 system block 来源信息。 */
function resolve_composed_system_blocks(
  composed: SessionStepInput,
): AgentSessionSystemBlock[] {
  const declared_blocks = composed.system_blocks || [];
  return composed.system.flatMap((message, index) => {
    const content = stringify_system_content(message.content);
    if (!content) return [];
    const declared = declared_blocks[index];
    if (declared && declared.content.trim() === content) {
      return [{ ...declared, content }];
    }
    return [{
      source: "session" as const,
      name: `custom_system:${index + 1}`,
      content,
    }];
  });
}
