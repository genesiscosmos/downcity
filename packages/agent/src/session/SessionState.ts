/**
 * SessionState：本地 Session 配置与 Metadata 状态。
 *
 * 关键点（中文）
 * - 统一管理本地 Session 的初始化、配置、标题与 metadata。
 * - Message 持久化统一交给 `SessionMessages`，这里仅读取 Message 快照更新 metadata。
 * - 不负责 Turn 编排、Message 创建或 Action 生命周期。
 */

import {
  infer_agent_model_label,
  read_agent_model_context_window,
} from "@/agent/AgentModel.js";
import { resolve_system_timezone } from "@/session/storage/Metadata.js";
import { ensure_session_title } from "@/session/SessionTitle.js";
import type {
  AgentSessionConfigSnapshot,
} from "@/types/agent/SessionTypes.js";
import type { AgentModel } from "@/agent/AgentModel.js";
import type { SessionLocalState } from "@/types/session/SessionLocalState.js";
import { generate_id } from "@/utils/Id.js";
import type { Logger } from "@/utils/logger/Logger.js";
import { SessionMessages } from "@/session/SessionMessages.js";
import { SessionTitleTask } from "@/session/runtime/SessionTitleTask.js";
import { to_executor_history } from "@/session/messages/SessionMessageCodec.js";
import type { SessionMessage } from "@/types/session/SessionMessage.js";
import { is_session_message_record } from "@/executor/types/SessionRecords.js";
import type { SessionStateOptions } from "@/types/session/SessionState.js";
import type { SessionDataStore } from "@/types/store/SessionDataStore.js";
import type { SessionApprovalMode } from "@/types/session/SessionInteraction.js";

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
  private readonly agent_id: string;
  private readonly session_id: string;
  private readonly store: SessionDataStore;
  private readonly messages: SessionMessages;
  private readonly state: SessionLocalState;
  private readonly logger: Logger;
  private readonly ensure_configured_hook?: SessionStateOptions["ensure_configured_hook"];
  private readonly get_model: SessionStateOptions["get_model"];
  private readonly publish_event: SessionStateOptions["publish_event"];
  private readonly title_task: SessionTitleTask;
  private metadata_mutation_chain: Promise<void> = Promise.resolve();

  constructor(options: SessionStateOptions) {
    this.agent_id = options.agent_id;
    this.session_id = options.session_id;
    this.store = options.store;
    this.messages = options.messages;
    this.state = options.state;
    this.logger = options.logger;
    this.ensure_configured_hook = options.ensure_configured_hook;
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
    if (this.state.initialize_promise) {
      await this.state.initialize_promise;
      return;
    }
    this.state.initialize_promise = (async () => {
      const metadata = await this.store.read_metadata();
      const created_at =
        typeof metadata.created_at === "number" ? metadata.created_at : Date.now();
      const timezone =
        typeof metadata.timezone === "string" && metadata.timezone.trim()
          ? metadata.timezone.trim()
          : resolve_system_timezone();
      await this.store.write_metadata({
        ...metadata,
        agent_id: this.agent_id,
        created_at: created_at,
        timezone,
      });
      this.state.created_at = created_at;
      this.state.timezone = timezone;
      this.state.session_config = {
        ...(metadata.model_label ? { model_label: metadata.model_label } : {}),
      };
      this.state.effective_session_config = {
        ...this.state.session_config,
      };
      this.state.configured_approval_mode = metadata.approval_mode || "ask";
    })();
    await this.state.initialize_promise;
  }

  /**
   * 在执行前确保当前 session 已完成初始化与宿主装配。
   */
  async ensure_ready_for_execution(): Promise<void> {
    await this.initialize();
    if (this.state.ensure_configured_promise) {
      await this.state.ensure_configured_promise;
      return;
    }
    this.state.ensure_configured_promise = (async () => {
      if (!this.ensure_configured_hook) return;
      await this.ensure_configured_hook();
    })();
    try {
      await this.state.ensure_configured_promise;
    } catch (error) {
      this.state.ensure_configured_promise = null;
      throw error;
    }
  }

  /**
   * 在 prompt 执行前确保当前 session 已可运行。
   */
  async ensure_runnable(): Promise<void> {
    await this.ensure_ready_for_execution();
    if (!this.get_model()) {
      throw new Error("requires a configured model.");
    }
  }

  /**
   * 写入当前 session 配置。
   */
  async set_model(model: AgentModel): Promise<SessionModelSetResult> {
    const next_model_label = infer_agent_model_label(model);
    const changed = next_model_label !== this.state.session_config.model_label;
    const next_config: AgentSessionConfigSnapshot = {
      ...this.state.session_config,
      model,
      model_label: next_model_label,
      model_context_window: read_agent_model_context_window(model),
    };
    if (changed) {
      await this.run_metadata_mutation(async () => {
        const metadata = await this.store.read_metadata();
        await this.store.write_metadata({
          ...metadata,
          agent_id: this.agent_id,
          updated_at: Date.now(),
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
        updated_at: Date.now(),
        approval_mode: mode,
      });
    });
    this.state.configured_approval_mode = mode;
    return true;
  }

  /** 在 Session Step 检查点提交模型配置。 */
  apply_model_config(config: AgentSessionConfigSnapshot): void {
    this.state.effective_session_config = {
      ...config,
    };
  }

  /**
   * 仅刷新当前 session metadata。
   */
  async touch_metadata(): Promise<void> {
    const stats = await this.messages.storage_stats();
    const preview_text = resolve_message_preview(
      stats.latest_message || undefined,
    ).slice(0, 180);
    await this.run_metadata_mutation(async () => {
      const metadata = await this.store.read_metadata();
      await this.store.write_metadata({
        ...metadata,
        agent_id: this.agent_id,
        updated_at: Date.now(),
        ...(this.state.session_config.model_label
          ? { model_label: this.state.session_config.model_label }
          : {}),
        message_count: stats.message_count,
        historyBytes: stats.history_bytes,
        ...(preview_text ? { preview_text: preview_text } : {}),
      });
    });
  }

  /** 在后台刷新 Session metadata，不阻塞当前 Turn。 */
  touch_metadata_in_background(): void {
    void this.touch_metadata().catch(async (error) => {
      try {
        await this.logger.log("warn", "[agent] session_metadata.background_update_failed", {
          session_id: this.session_id,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // metadata 诊断日志失败不能影响当前 Turn。
      }
    });
  }

  /** 异步调度首条用户消息的 Session 标题生成。 */
  schedule_title_generation(): void {
    this.title_task.schedule(async (signal) => {
      const before_metadata = await this.store.read_metadata();
      if (String(before_metadata.title || "").trim()) return;
      const records = to_executor_history(
        this.session_id,
        await this.messages.context_snapshot(),
      );
      const first_user_message = records.find(
        (record) => is_session_message_record(record) && record.role === "user",
      );
      if (!first_user_message) return;
      const first_user_message_id = first_user_message.id;
      const before_title = String(before_metadata.title || "").trim();
      const next_metadata = await ensure_session_title({
        session_id: this.session_id,
        store: this.store,
        messages: records,
        model: this.get_model(),
        model_label: this.state.session_config.model_label,
        logger: this.logger,
        generate: true,
        signal,
        commit_title: async (title) => await this.run_metadata_mutation(async () => {
          const latest_metadata = await this.store.read_metadata();
          if (signal.aborted) return latest_metadata;
          if (String(latest_metadata.title || "").trim()) return latest_metadata;
          const latest_records = to_executor_history(
            this.session_id,
            await this.messages.context_snapshot(),
          );
          const source_exists = latest_records.some(
            (record) =>
              is_session_message_record(record) &&
              record.id === first_user_message_id,
          );
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

function resolve_message_preview(message: SessionMessage | undefined): string {
  if (!message) return "";
  if (message.type === "user") {
    return message.parts
      .flatMap((part) => part.type === "text" ? [part.text] : [])
      .join("")
      .trim();
  }
  if (message.type === "assistant") {
    return message.parts
      .flatMap((part) => part.type === "text" ? [part.text] : [])
      .join("")
      .trim();
  }
  if (message.type === "action") {
    return [message.title, message.description].filter(Boolean).join("\n");
  }
  return message.message.trim();
}
