/**
 * SessionState：本地 Session 配置与 Metadata 状态。
 *
 * 关键点（中文）
 * - 统一管理本地 Session 的初始化、配置、标题与 metadata。
 * - Message 持久化统一交给 `SessionMessages`，这里仅读取 Message 快照更新 metadata。
 * - 不负责 Turn 编排、Message 创建或 Action 生命周期。
 */

import { read_model_context_window, read_model_label, type ModelClient, normalize_session_descriptor } from "@downcity/type";
import { normalize_session_title, resolve_system_timezone } from "@/session/storage/Metadata.js";
import { ensure_session_title } from "@/session/loop/SessionTitle.js";
import type { AgentSessionConfigSnapshot } from "@/types/agent/SessionTypes.js";
import type { SessionLocalState } from "@/types/session/SessionLocalState.js";
import { generate_id } from "@/utils/Id.js";
import type { Logger } from "@/utils/logger/Logger.js";
import { SessionTitleTask } from "@/session/loop/SessionTitleTask.js";
import type { SessionStateOptions } from "@/types/session/SessionState.js";
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import type { SessionApprovalMode, WorkspaceRuntime } from "@downcity/type";
import { create_session_model_request_warning } from "@/session/messages/SessionModelRequestWarning.js";

/** 创建单个 Session 唯一的可变内存状态。 */
export function create_session_local_state(input: {
  /** Session 创建时的初始 Workspace；省略表示没有项目上下文。 */
  workspace?: WorkspaceRuntime;
  /** 没有 Workspace 时使用的目录回退值。 */
  fallback_workspace_path: string;
}): SessionLocalState {
  return {
    session_config: {},
    effective_session_config: {},
    configured_approval_mode: "ask",
    ...(input.workspace ? { current_workspace: input.workspace } : {}),
    fallback_workspace_path: input.fallback_workspace_path,
    created_at: Date.now(),
    timezone: resolve_system_timezone(),
    initialize_promise: null,
  };
}

/** Session 模型配置写入结果。 */
export interface SessionModelSetResult {
  /** 已包含最新运行时模型实例的 configured 快照。 */
  config: AgentSessionConfigSnapshot;
  /** 持久化模型身份是否发生真实变化。 */
  changed: boolean;
}

/**
 * 本地 Session 配置与 Metadata 状态管理器。
 */
export class SessionState {
  private readonly workspace_id?: string;
  private readonly agent_id: string;
  private readonly session_id: string;
  /** 会话的顶层类型。 */
  readonly type!: import("@downcity/type").SessionType;
  /** 创建入口或工作用途。 */
  readonly kind!: string;
  /** 已有创建事实中的父执行引用。 */
  readonly parent?: import("@downcity/type").SessionParent;
  /** 已有创建事实中的固定派生深度。 */
  readonly delegation_depth?: number;
  /** 已有父会话类型。 */
  readonly parent_session_type?: import("@downcity/type").SessionType;
  /** 已有派生事实中的根 Chat 引用。 */
  readonly root_chat_session_id?: string;
  /** 群组成员所属的群组标识。 */
  readonly group_id?: string;
  /** 所属群组对话标识。 */
  readonly group_session_id?: string;
  private readonly store: SessionStorage;
  private readonly state: SessionLocalState;
  private readonly logger: Logger;
  private readonly get_model: SessionStateOptions["get_model"];
  private readonly publish_event: SessionStateOptions["publish_event"];
  private readonly title_task: SessionTitleTask;
  private metadata_mutation_chain: Promise<void> = Promise.resolve();

  constructor(options: SessionStateOptions) {
    this.workspace_id = options.workspace_id;
    this.agent_id = options.agent_id;
    this.session_id = options.session_id;
    Object.assign(this, normalize_session_descriptor(options));
    this.store = options.store;
    this.state = options.state;
    this.logger = options.logger;
    this.get_model = options.get_model;
    this.publish_event = options.publish_event;
    this.title_task = new SessionTitleTask({
      session_id: this.session_id,
      logger: this.logger,
    });
  }

  /**
   * 读取当前 session 配置快照。
   */
  get_config(): AgentSessionConfigSnapshot {
    return {
      ...this.state.session_config,
    };
  }

  /** 读取当前 Session 已接受的 Shell 审批模式。 */
  get_approval_mode(): SessionApprovalMode {
    return this.state.configured_approval_mode;
  }

  /**
   * 读取当前 session 创建时间。
   */
  get_created_at(): number {
    return this.state.created_at;
  }

  /**
   * 读取当前 session 参考时区。
   */
  get_timezone(): string {
    return this.state.timezone;
  }

  /**
   * 初始化当前 session metadata 与内存快照。
   */
  async initialize(): Promise<void> {
    if (!this.state.initialize_promise) {
      this.state.initialize_promise = (async () => {
        const metadata = await this.store.read_metadata();
        if (metadata.workspace_id !== this.workspace_id) throw new Error("session_workspace_immutable");
        const created_at =
          typeof metadata.created_at === "number" ? metadata.created_at : Date.now();
        const timezone =
          typeof metadata.timezone === "string" && metadata.timezone.trim()
            ? metadata.timezone.trim()
            : resolve_system_timezone();
        await this.store.write_metadata({
          ...metadata,
          created_at: created_at,
          timezone,
          ...normalize_session_descriptor(this),
        });
        this.state.created_at = created_at;
        this.state.timezone = timezone;
        // 初始化与中断消息恢复并行，保留恢复提交已推进的活动时间。
        this.state.updated_at = Math.max(this.state.updated_at ?? 0, metadata.updated_at ?? created_at);
        this.state.title = normalize_session_title(metadata.title);
        this.state.session_config = {
          ...(metadata.model_label ? { model_label: metadata.model_label } : {}),
        };
        this.state.effective_session_config = {
          ...this.state.session_config,
        };
        this.state.configured_approval_mode = metadata.approval_mode || "ask";
      })();
    }
    const initialize_promise = this.state.initialize_promise;
    try {
      await initialize_promise;
    } catch (error) {
      if (this.state.initialize_promise === initialize_promise) {
        this.state.initialize_promise = null;
      }
      throw error;
    }
  }

  /**
   * 在执行前确保当前 session 已完成初始化。
   */
  async ensure_ready_for_execution(): Promise<void> {
    await this.initialize();
  }

  /**
   * 在 prompt 执行前确保当前 session 已可运行。
   */
  async ensure_runnable(): Promise<void> {
    await this.ensure_ready_for_execution();
    if (!this.get_model()) {
      throw Object.assign(new Error("Session requires an explicit model selection; historical labels cannot reconstruct a model ID. Select a Session model before execution."), { code: "session_model_required" });
    }
  }

  /**
   * 写入当前 session 配置。
   */
  async set_model(model: ModelClient): Promise<SessionModelSetResult> {
    const next_model_label = read_model_label(model);
    const binding = await this.store.read_model_binding();
    const next_model_reference = model.model_reference;
    const changed = next_model_label !== this.state.session_config.model_label
      || (next_model_reference
        ? binding?.model?.downtown !== next_model_reference.downtown || binding.model.id !== next_model_reference.id
        : this.state.session_config.model?.id !== model.id);
    const next_config: AgentSessionConfigSnapshot = {
      ...this.state.session_config,
      model,
      model_label: next_model_label,
      model_context_window: read_model_context_window(model),
    };
    // 即使展示名未变化，也必须保存稳定 ID；旧历史明确选择后才获得可恢复模型。
    if (next_model_reference) await this.store.write_model_binding({ model: next_model_reference });
    if (changed) {
      await this.run_metadata_mutation(async () => {
        const metadata = await this.store.read_metadata();
        await this.store.write_metadata({
          ...metadata,
          ...(next_model_label ? { model_label: next_model_label } : {}),
        });
      });
    }
    this.state.session_config = next_config;
    return { config: next_config, changed };
  }

  /** 接受并持久化当前 Session 的 Shell 审批模式。 */
  async set_approval_mode(mode: SessionApprovalMode): Promise<boolean> {
    if (mode === this.state.configured_approval_mode) return false;
    await this.run_metadata_mutation(async () => {
      const metadata = await this.store.read_metadata();
      await this.store.write_metadata({
        ...metadata,
        agent_id: this.agent_id,
        approval_mode: mode,
      });
    });
    this.state.configured_approval_mode = mode;
    return true;
  }

  /** 原子修改 Session 标题并发布唯一的标题 mutation。 */
  async set_title(input: string): Promise<string> {
    const title = normalize_session_title(input);
    if (!title) throw new Error("session.rename requires a non-empty title");
    this.title_task.dispose();
    const changed = await this.run_metadata_mutation(async () => {
      const metadata = await this.store.read_metadata();
      if (normalize_session_title(metadata.title) === title) return false;
      await this.store.write_metadata({
        ...metadata,
        agent_id: this.agent_id,
        title,
      });
      return true;
    });
    if (changed) {
      this.state.title = title;
      this.publish_event({
        mutation_id: generate_id(),
        variant: "session",
        type: "title",
        session_id: this.session_id,
        created_at: Date.now(),
        title,
      });
    }
    return title;
  }

  /** 返回当前 Session 正在使用的 Workspace；没有项目上下文时为空。 */
  get_workspace_instance(): WorkspaceRuntime | undefined {
    return this.state.current_workspace;
  }

  /** 返回当前目录路径；没有 Workspace 时使用回退值。 */
  get_workspace_path(): string {
    return String(this.state.current_workspace?.path || "").trim()
      || this.state.fallback_workspace_path;
  }

  /** 在 Session Step 检查点提交模型配置。 */
  apply_model_config(config: AgentSessionConfigSnapshot): void {
    this.state.effective_session_config = {
      ...config,
    };
  }

  /** 异步调度首条用户消息的 Session 标题生成。 */
  schedule_title_generation(): void {
    this.title_task.schedule(async (signal) => {
      const before_metadata = await this.store.read_metadata();
      if (String(before_metadata.title || "").trim()) return;
      const first_user_message = await this.store.read_first_user_message();
      if (!first_user_message) return;
      const first_user_message_id = first_user_message.message_id;
      const before_title = String(before_metadata.title || "").trim();
      const next_metadata = await ensure_session_title({
        session_id: this.session_id,
        store: this.store,
        messages: [first_user_message],
        model: this.get_model(),
        model_label: this.state.session_config.model_label,
        logger: this.logger,
        generate: true,
        signal,
        on_model_request_failure: (notice) => {
          this.publish_event(create_session_model_request_warning({
            session_id: this.session_id,
            notice,
          }));
        },
        commit_title: async (title) => await this.run_metadata_mutation(async () => {
          const latest_metadata = await this.store.read_metadata();
          if (signal.aborted) return latest_metadata;
          if (String(latest_metadata.title || "").trim()) return latest_metadata;
          const source_message = await this.store.read_message(
            first_user_message_id,
          );
          const source_exists = source_message?.role === "user";
          if (!source_exists || signal.aborted) return latest_metadata;
          const next_metadata = { ...latest_metadata, title };
          await this.store.write_metadata(next_metadata);
          return next_metadata;
        }),
      });
      const next_title = String(next_metadata.title || "").trim();
      if (!next_title || next_title === before_title || signal.aborted) return;
      this.publish_event({
        mutation_id: generate_id(),
        variant: "session",
        type: "title",
        session_id: this.session_id,
        created_at: Date.now(),
        title: next_title,
      });
    });
  }

  /** 取消并释放当前 Session 的标题后台任务。 */
  dispose_title_generation(): void {
    this.title_task.dispose();
  }

  /** 串行提交 Session metadata，避免后台标题覆盖其他字段。 */
  private async run_metadata_mutation<T>(mutation: () => Promise<T>): Promise<T> {
    const task = this.metadata_mutation_chain.then(mutation, mutation);
    this.metadata_mutation_chain = task.then(
      () => undefined,
      () => undefined,
    );
    return await task;
  }

}
