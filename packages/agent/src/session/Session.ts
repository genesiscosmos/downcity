/**
 * SDK 本地 Session 封装。
 *
 * 关键点（中文）
 * - 面向 `new Agent(...)` 的本地会话使用场景。
 * - 对外保留稳定 Session facade，把状态、turn、view 逻辑下沉到独立 service。
 * - 内部使用 `SessionMessages` 管理 SQLite 中的 canonical Message 聚合。
 */

import {
  type ModelClient,
  read_model_context_window,
  read_model_label,
  type RuntimeTool as Tool,
} from "@downcity/type";
import { SessionMessages } from "@/session/SessionMessages.js";
import type {
  AgentSessionConfigSnapshot,
  AgentSessionForkInput,
  AgentSessionInfo,
  AgentSessionStatus,
  AgentSessionSetInput,
  AgentSessionSetOptions,
  AgentSessionSystemSnapshot,
} from "@/types/agent/SessionTypes.js";
import type { AgentSession } from "@/types/agent/SessionActor.js";
import { create_runtime_session_port } from "@/session/storage/RuntimeSessionPort.js";
import type { SessionPort } from "@/types/session/SessionPort.js";
import type { SessionMutationSubscriber, SessionMutationUnsubscribe } from "@downcity/type";
import type {
  RespondSessionInteractionInput,
  SessionApprovalMode,
  SessionInteractionResult,
  SessionInteractionRequest,
} from "@downcity/type";
import type { ListSessionMessagesInput, SessionMessagePage } from "@downcity/type";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type { AgentSessionStopResult } from "@/types/sdk/AgentSessionStop.js";
import type { AgentSessionTurnHandle } from "@/types/sdk/AgentSessionTurn.js";
import { SessionEventHub } from "@/session/runtime/SessionEventHub.js";
import {
  create_session_local_state,
  SessionState,
} from "@/session/SessionState.js";
import { SessionLoop } from "@/session/SessionLoop.js";
import { SessionQueue } from "@/session/SessionQueue.js";
import type { SessionLocalState } from "@/types/session/SessionLocalState.js";
import type { SessionOptions } from "@/types/session/SessionOptions.js";
import type { SessionHookRuntime } from "@downcity/type";
import { SessionInteractions } from "@/session/control/SessionInteractions.js";
import { SessionApprovalRuntime } from "@/session/execution/tools/SessionApprovalRuntime.js";
import { DefaultSessionComposer } from "@/session/composer/DefaultSessionComposer.js";
import type { SessionComposer } from "@/types/session/SessionComposer.js";
import { generate_id } from "@/utils/Id.js";
import { nanoid } from "nanoid";
import { build_session_info } from "@/session/browse/Browse.js";
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import type {
  AppendExternalSessionAgentMessageInput,
  AppendExternalSessionUserMessageInput,
} from "@/types/session/SessionMessages.js";
import { StepInput } from "@/session/StepInput.js";
import {
  relocate_fork_message_files,
  resolve_session_fork_messages,
} from "@/session/messages/SessionForkMessageFiles.js";
import { create_session_model_request_warning } from "@/session/runtime/SessionModelRequestWarning.js";
import type { SessionContextAdvanceTrigger } from "@/types/session/SessionComposer.js";

/**
 * SDK 本地 Session。
 */
export class Session implements AgentSession {
  readonly id: string;
  readonly agent_id: string;
  /** 当前 Session 创建时绑定的 Workspace ID。 */
  readonly workspace_id?: string;
  /** 当前 Session 的创建来源。 */
  readonly origin: SessionOptions["origin"];

  private readonly workspace_path: string;
  private readonly store: SessionStorage;
  private readonly create_session_store: SessionOptions["create_session_store"];
  private readonly register_forked_session: SessionOptions["register_forked_session"];
  private readonly get_tools: SessionOptions["get_tools"];
  private readonly logger: SessionOptions["logger"];
  private readonly get_managed_power_system_blocks: SessionOptions["get_managed_power_system_blocks"];
  private readonly ensure_configured_hook?: SessionOptions["ensure_configured"];
  private readonly composer: SessionComposer;
  private readonly create_composer: () => SessionComposer;
  private readonly session_messages: SessionMessages;
  private readonly events: SessionEventHub;
  private readonly session_interactions: SessionInteractions;
  private readonly approval_runtime: SessionApprovalRuntime;
  private readonly local_state: SessionLocalState;
  private readonly get_workspace_env: SessionOptions["get_workspace_env"];
  private readonly get_agent_model: SessionOptions["get_agent_model"];
  private readonly get_hooks: SessionOptions["get_hooks"];
  private readonly get_instruction_system_blocks:
    SessionOptions["get_instruction_system_blocks"];
  /** 当前 Session 的一次性初始化任务，避免缓存实例被重复恢复运行时状态。 */
  private initialize_promise: Promise<void> | null = null;
  /** 当前 Session 的 system snapshot 与 Step 组装边界。 */
  private readonly step_input: StepInput;
  private readonly state: SessionState;
  /** 当前 Session 独享的 Command FIFO。 */
  private readonly session_queue = new SessionQueue();
  private readonly session_loop: SessionLoop;
  private runtime_port: SessionPort | null = null;

  constructor(options: SessionOptions) {
    this.id = String(options.session_id || "").trim();
    this.agent_id = String(options.agent_id || "").trim();
    this.workspace_id = String(options.workspace_id || "").trim() || undefined;
    this.origin = options.origin;
    this.workspace_path = String(options.workspace_path || "").trim();
    this.store = options.store;
    this.create_session_store = options.create_session_store;
    this.register_forked_session = options.register_forked_session;
    this.get_tools = options.get_tools;
    this.logger = options.logger;
    this.get_workspace_env = options.get_workspace_env;
    this.get_agent_model = options.get_agent_model;
    this.get_hooks = options.get_hooks;
    this.get_instruction_system_blocks = options.get_instruction_system_blocks;
    this.get_managed_power_system_blocks = options.get_managed_power_system_blocks;
    this.ensure_configured_hook = options.ensure_configured;
    this.create_composer = options.create_composer ||
      (() => new DefaultSessionComposer());
    this.composer = this.create_composer();
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
      store: this.store,
      attachment_store: this.store.attachments,
      publish: (mutation) => {
        this.events.publish(mutation);
      },
    });
    this.session_interactions = new SessionInteractions({
      session_id: this.id,
      messages: this.session_messages,
    });
    this.approval_runtime = new SessionApprovalRuntime({
      session_id: this.id,
      interactions: this.session_interactions,
    });
    this.local_state = create_session_local_state();
    this.step_input = new StepInput({
      agent_id: this.agent_id,
      session_id: this.id,
      session_origin: this.origin,
      workspace_path: this.workspace_path,
      store: this.store,
      composer: this.composer,
      get_tools: this.get_tools,
      instruction_system_blocks: options.instruction_system_blocks,
      get_instruction_system_blocks: this.get_instruction_system_blocks,
      get_hooks: this.get_hooks,
      get_workspace_env: this.get_workspace_env,
      get_managed_power_system_blocks: this.get_managed_power_system_blocks,
      get_model: () => this.get_model(),
      get_model_context_window: () => this.get_model_context_window(),
      get_created_at: () => this.local_state.created_at,
      get_timezone: () => this.local_state.timezone,
      logger: this.logger,
    });
    this.state = new SessionState({
      agent_id: this.agent_id,
      session_id: this.id,
      origin: this.origin,
      store: this.store,
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
      session_origin: this.origin,
      workspace_path: this.workspace_path,
      step_input: this.step_input,
      advance_context: async (trigger) => await this.advance_context(trigger),
      maintain_context: async () => {
        await this.advance_context("usage_pressure");
      },
      state: this.state,
      events: this.events,
      logger: this.logger,
      messages: this.session_messages,
      interactions: this.session_interactions,
      shell_approval_gateway: this.approval_runtime,
      approval: this.approval_runtime,
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
          this.step_input.initialize(),
          this.session_messages.initialize(),
          this.state.initialize(),
        ]);
        this.approval_runtime.set_effective_mode(
          this.state.get_approval_mode(),
        );
      })();
    }
    const initialize_promise = this.initialize_promise;
    try {
      await initialize_promise;
    } catch (error) {
      if (this.initialize_promise === initialize_promise) {
        this.initialize_promise = null;
      }
      throw error;
    }
    return this;
  }

  /**
   * 把当前 Session 首次生成后固定的完整 system 显式固化到 instruction.md。
   *
   * 关键点（中文）
   * - 包含 instruction、SDK core、Power system 与 Session context。
   * - 多个 system block 按原顺序合并为一个 Markdown 文档。
   */
  async snapshot(): Promise<void> {
    await this.step_input.snapshot();
  }

  /**
   * 使用 Agent 当前 instruction 与 Power 重新生成一次完整 system。
   *
   * 关键点（中文）
   * - 只替换内存 snapshot，不改变 Power execution view。
   * - instruction.md 已存在时同步覆盖；不存在时不自动创建。
   * - 当前已经发出的 provider 请求不受影响，后续 step 使用新 snapshot。
   */
  async syncshot(): Promise<void> {
    await this.step_input.syncshot();
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
    this.session_loop.enqueue_command({
      kind: "maintenance",
      execute: async () => {
        if (model_result) this.state.apply_model_config(model_result.config);
        if (security_changed && next_approval_mode) {
          this.approval_runtime.set_effective_mode(next_approval_mode);
        }
      },
      ...(completion ? { completion } : {}),
    });
  }

  /** 修改当前 Session 的用户可见标题。 */
  async rename(title: string): Promise<string> {
    return await this.state.set_title(title);
  }

  /**
   * 追加一条新的 Session prompt。
   */
  async prompt(input: AgentSessionPromptInput): Promise<AgentSessionTurnHandle> {
    await this.step_input.initialize();
    return await this.session_loop.prompt(input);
  }

  /**
   * 停止当前 turn，并取消尚未被吸收的排队 prompt。
   */
  async stop(): Promise<AgentSessionStopResult> {
    return await this.session_loop.stop();
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
  async interactions(): Promise<SessionInteractionRequest[]> {
    return this.session_interactions.list();
  }

  /** 读取当前 Session 的运行与安全状态。 */
  async status(): Promise<AgentSessionStatus> {
    const active_turn_id = this.session_loop.current_turn_id();
    return {
      session_id: this.id,
      state: active_turn_id || this.session_loop.is_executing() ? "running" : "idle",
      ...(active_turn_id ? { active_turn_id } : {}),
      security: {
        approval_mode: this.state.get_approval_mode(),
        effective_approval_mode: this.approval_runtime.get_effective_mode(),
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
    await this.append_external_user_message({
      text: String(input.text || "").trim(),
    });
  }

  /**
   * 追加一条 Agent 文本消息。
   */
  async append_agent_message(input: {
    text: string;
  }): Promise<void> {
    await this.append_external_agent_message({
      text: String(input.text || "").trim(),
    });
  }

  /**
   * 读取当前 session 详情。
   */
  async get_info(): Promise<AgentSessionInfo> {
    const metadata = await this.store.read_metadata();
    const model_label = String(
      metadata.model_label ||
      read_model_label(this.get_selected_model()) ||
      "",
    ).trim();
    return build_session_info({
      project_root: this.workspace_path,
      agent_id: this.agent_id,
      session_id: this.id,
      metadata: {
        ...metadata,
        ...(model_label ? { model_label } : {}),
      },
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
    return await this.step_input.read_system();
  }

  /**
   * 返回当前 session 是否正在执行。
   */
  is_executing(): boolean {
    return this.session_loop.is_active() || this.session_loop.is_executing();
  }

  /**
   * 从当前 session 创建一个分叉会话。
   *
   * 复制历史与附件是分叉 Session 自身的建立过程，因此 fork 的 Action 只记录在新 Session
   * 时间线末尾，源 Session 不留下任何痕迹；失败时直接抛错，由调用方决定半成品 Session 的去留。
   */
  async fork(input?: AgentSessionForkInput | string): Promise<this> {
    const message_id = typeof input === "string"
      ? String(input || "").trim() || undefined
      : String(input?.message_id || "").trim() || undefined;
    const include_message = typeof input === "string" || input?.include_message !== false;
    const messages = await this.session_messages.list_history_messages();
    const fork_messages = message_id
      ? resolve_session_fork_messages({
          session_id: this.id,
          messages,
          message_id,
          include_message,
        })
      : messages;
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
    forked.approval_runtime.set_effective_mode(approval_mode);
    const relocated_messages = await relocate_fork_message_files(fork_messages, this.store.attachments, forked.store.attachments);
    await forked.session_messages.import_messages(relocated_messages);
    await forked.session_messages.persist_action({
      action_id: `history-fork:${forked.id}:${Date.now()}:${nanoid(8)}`,
      action_type: "history-fork",
      title: "Session messages forked",
      description: `Copied ${String(fork_messages.length)} messages from session ${this.id}.`,
      status: "completed",
    });
    this.register_forked_session(forked);
    return forked;
  }

  /**
   * 返回供宿主运行时使用的 Session 端口。
   */
  get_runtime_port(): SessionPort {
    if (this.runtime_port) return this.runtime_port;
    this.runtime_port = create_runtime_session_port({
      session_id: this.id,
      get_model: () => this.get_model(),
      messages: async () => await this.session_messages.list_history_messages(),
      prompt: async (input) => await this.prompt(input),
      stop: async () => await this.stop(),
      subscribe: (subscriber) => this.subscribe(subscriber),
      append_user_message: async (message_params) =>
        await this.append_external_user_message(message_params),
      append_agent_message: async (message_params) =>
        await this.append_external_agent_message(message_params),
      is_executing: () => this.is_executing(),
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
    await this.step_input.initialize();
    await this.state.ensure_ready_for_execution();
  }

  private create_fork_session(session_id: string): this {
    return this.create_child_session({
      agent_id: this.agent_id,
      workspace_path: this.workspace_path,
      ...(this.workspace_id ? { workspace_id: this.workspace_id } : {}),
      origin: this.origin,
      store: this.create_session_store(session_id),
      create_session_store: this.create_session_store,
      register_forked_session: this.register_forked_session,
      session_id: session_id,
      get_tools: this.get_tools,
      logger: this.logger,
      instruction_system_blocks: this.step_input.instruction_blocks(),
      get_instruction_system_blocks: this.get_instruction_system_blocks,
      get_workspace_env: this.get_workspace_env,
      get_hooks: this.get_hooks,
      get_managed_power_system_blocks: this.get_managed_power_system_blocks,
      ensure_configured: this.ensure_configured_hook,
      get_agent_model: this.get_agent_model,
      create_composer: this.create_composer,
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

  /**
   * 让 Composer 尝试推进派生上下文状态。
   *
   * 上下文推进是用户可见的 Session 操作，因此结果记录为 Action：写入派生边界时记为
   * completed，抛错时记为 failed。Composer 判定没有可推进区间时返回 false，此时不产生
   * Action，避免空操作污染时间线。
   */
  private async advance_context(
    trigger: SessionContextAdvanceTrigger,
  ): Promise<boolean> {
    const turn_id = this.session_loop.current_turn_id();
    const action_id = `context-compaction:${this.id}:${generate_id()}`;
    try {
      const advanced = await this.composer.advance_context({
        session: this.step_input.identity(),
        model: this.get_model(),
        history: await this.store.list_messages(),
        derived: this.store.derived_store(this.composer.name),
        trigger,
        on_model_request_failure: (notice) => {
          this.events.publish(create_session_model_request_warning({
            session_id: this.id,
            turn_id: this.session_loop.current_turn_id(),
            notice,
          }));
        },
      });
      if (advanced) {
        await this.record_compaction_action({
          action_id,
          turn_id,
          status: "completed",
          title: "Session context compacted",
          description: "Older stable parts were folded into the context summary.",
        });
      }
      return advanced;
    } catch (error) {
      await this.record_compaction_action({
        action_id,
        turn_id,
        status: "failed",
        title: "Session context compaction failed",
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** 记录一次上下文压缩结果；Action 观测失败不能改变压缩本身的执行结果。 */
  private async record_compaction_action(input: {
    /** 本次压缩生命周期的稳定标识。 */
    action_id: string;
    /** 压缩所属 Turn；独立的 Session 压缩可以省略。 */
    turn_id?: string;
    /** 压缩结果状态。 */
    status: "completed" | "failed";
    /** Action 展示标题。 */
    title: string;
    /** Action 展示描述。 */
    description?: string;
  }): Promise<void> {
    try {
      await this.session_messages.persist_action({
        action_id: input.action_id,
        action_type: "context-compaction",
        ...(input.turn_id ? { turn_id: input.turn_id } : {}),
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        status: input.status,
      });
    } catch (error) {
      try {
        await this.logger.log("warn", "[agent] context compaction action failed", {
          session_id: this.id,
          action_id: input.action_id,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // 压缩结果已经确定，日志失败同样不能反向改变执行结果。
      }    }
  }

  /**
   * 返回当前 Session 实际使用的模型实例。
   *
   * 解析顺序固定为 Session 覆盖模型，其次回退到 Agent 模型。
   */
  get_model(): ModelClient | undefined {
    return this.get_selected_model();
  }

  /** 按 Session 优先、Agent 兜底规则读取当前配置的 ModelClient。 */
  private get_selected_model(): ModelClient | undefined {
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
      read_model_context_window(this.get_selected_model())
    );
  }

  /** 追加外部 User Message，并统一触发 Metadata 与标题更新。 */
  private async append_external_user_message(
    input: AppendExternalSessionUserMessageInput,
  ): Promise<void> {
    const appended = await this.session_messages.append_external_user_message(
      input,
    );
    if (!appended) return;
    this.state.schedule_title_generation();
  }

  /** 追加外部 Assistant Message，并统一提交 Metadata。 */
  private async append_external_agent_message(
    input: AppendExternalSessionAgentMessageInput,
  ): Promise<void> {
    await this.session_messages.append_external_agent_message(
      input,
    );
  }
}
