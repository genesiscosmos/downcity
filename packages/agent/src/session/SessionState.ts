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
  AgentSessionSetInput,
} from "@/types/agent/SessionTypes.js";
import type { SessionLocalState } from "@/types/session/SessionLocalState.js";
import { generate_id } from "@/utils/Id.js";
import type { Logger } from "@/utils/logger/Logger.js";
import { SessionMessages } from "@/session/SessionMessages.js";
import { to_executor_history } from "@/session/messages/SessionMessageCodec.js";
import type { SessionMessage } from "@/types/session/SessionMessage.js";
import type {
  SessionConfiguredStateResult,
  SessionSetOptions,
  SessionStateOptions,
} from "@/types/session/SessionState.js";
import type { SessionStore } from "@/types/store/SessionStore.js";

/**
 * 本地 Session 配置与 Metadata 状态管理器。
 */
export class SessionState {
  private readonly agent_id: string;
  private readonly session_id: string;
  private readonly store: SessionStore;
  private readonly messages: SessionMessages;
  private readonly state: SessionLocalState;
  private readonly logger: Logger;
  private readonly ensure_configured_hook?: SessionStateOptions["ensure_configured_hook"];
  private readonly get_model: SessionStateOptions["get_model"];
  private readonly publish_event: SessionStateOptions["publish_event"];

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
  }

  /**
   * 读取当前 session 配置快照。
   */
  get_config(): AgentSessionConfigSnapshot {
    return {
      ...this.state.session_config,
    };
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
      this.state.session_config = {};
      this.state.effective_session_config = {
        ...this.state.session_config,
      };
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
  async set(
    input: AgentSessionSetInput,
    options?: SessionSetOptions,
  ): Promise<SessionConfiguredStateResult> {
    const should_emit_action = options?.emit_action !== false;
    const previous_model_label = this.state.session_config.model_label;
    const next_model = input.model;
    const next_model_label = next_model
      ? infer_agent_model_label(next_model)
      : undefined;
    const previous_model_name = String(previous_model_label || "").trim();
    const next_model_name = String(next_model_label || "").trim();
    const should_emit_model_switch_action = Boolean(
      next_model &&
        should_emit_action &&
        this.state.session_config.model &&
        previous_model_name &&
        next_model_name &&
        previous_model_name !== next_model_name,
    );
    const action_id = `model-switching:${this.session_id}:${Date.now()}:${generate_id()}`;

    const next_config: AgentSessionConfigSnapshot = {
      ...this.state.session_config,
    };
    if (next_model) {
      next_config.model = next_model;
      next_config.model_label = next_model_label;
      next_config.model_context_window =
        read_agent_model_context_window(next_model);
    }
    const metadata = await this.store.read_metadata();
    await this.store.write_metadata({
      ...metadata,
      agent_id: this.agent_id,
      updated_at: Date.now(),
      ...(next_model_label ? { model_label: next_model_label } : {}),
    });
    this.state.session_config = next_config;

    if (options?.emit_action === false) {
      this.apply_model_config(next_config);
      return {};
    }

    return {
      model_change: {
        config: next_config,
        ...(should_emit_model_switch_action
          ? {
              action_id,
              action_title:
                `Session model switched from ${previous_model_name} to ${next_model_name}`,
            }
          : {}),
      },
    };
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
  }

  /**
   * 确保当前 session 已持久化 title。
   */
  async ensure_title_from_history(input?: {
    /**
     * 是否允许调用模型生成标题。
     */
    generate?: boolean;
  }): Promise<void> {
    const messages = to_executor_history(
      this.session_id,
      await this.messages.context_snapshot(),
    );
    const before_metadata = await this.store.read_metadata();
    const before_title = String(before_metadata.title || "").trim();
    const next_metadata = await ensure_session_title({
      session_id: this.session_id,
      store: this.store,
      messages,
      ...(input?.generate
        ? {
            model: this.get_model(),
          }
        : {}),
      ...(this.state.session_config.model_label
        ? { model_label: this.state.session_config.model_label }
        : {}),
      logger: this.logger,
      generate: input?.generate === true,
    });
    const next_title = String(next_metadata.title || "").trim();
    if (!next_title || next_title === before_title) return;
    this.publish_event({
      mutation_id: generate_id(),
      variant: "session",
      type: "title",
      session_id: this.session_id,
      created_at: Date.now(),
      title: next_title,
    });
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
