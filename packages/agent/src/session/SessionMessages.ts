/**
 * SessionMessages：Session Message 的唯一领域入口。
 *
 * 完整 Message 与 Assistant 草稿先持久化，成功后再发布实时 Mutation。
 * 同一 Assistant Message 的流式、审批与关闭操作共享一条写队列，保证 revision
 * 从最新快照严格递增。
 */

import { generate_id } from "@/utils/Id.js";
import { SessionAgentMessageWriter } from "@/session/messages/SessionAgentMessageWriter.js";
import { SessionAgentMessageState } from "@/session/messages/SessionAgentMessageState.js";
import { SessionAgentActionPartWriter } from "@/session/messages/SessionAgentActionPartWriter.js";
import {
  has_assistant_result_content,
  normalize_canonical_session_user_parts,
  normalize_session_user_parts,
} from "@/session/messages/SessionUserMessage.js";
import type { JsonObject } from "@downcity/type";
import type {
  ListSessionMessagesInput,
  SessionActionStatus,
  SessionAgentActionPart,
  SessionAgentErrorPart,
  SessionAgentInteraction,
  SessionAgentMessage,
  SessionAgentMessagePart,
  SessionMessage,
  SessionMessagePage,
  SessionUserMessage,
  SessionUserMessagePart,
} from "@downcity/type";
import { create_session_part_mutation } from "@/session/messages/SessionMutationFactory.js";
import {
  next_agent_part_sequence,
  resolve_changed_agent_parts,
} from "@/session/messages/SessionAgentParts.js";
import type { SessionMutation } from "@downcity/type";
import type { SessionMessageStorageStats } from "@/types/store/SessionStorage.js";
import type { SessionStreamingToolLocation } from "@/types/session/SessionTool.js";
import type {
  SessionInteractionCloseInput,
  SessionInteractionRequest,
  SessionInteractionResponse,
} from "@downcity/type";
import type { SessionActionEvent } from "@downcity/type";
import { persist_user_prompt_file_parts } from "@executor/messages/SessionAttachmentMapper.js";
import type {
  AppendCompletedAgentMessageInput,
  AppendExternalSessionAgentMessageInput,
  AppendExternalSessionUserMessageInput,
  AppendSessionAgentErrorPartInput,
  AppendSessionPromptMessageInput,
  AppendSessionUserMessageInput,
  OpenSessionAgentActionPartInput,
  OpenSessionAgentMessageInput,
  SessionMessagesOptions,
} from "@/types/session/SessionMessages.js";
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import type { SessionAttachmentStore } from "@/types/store/SessionAttachmentStore.js";

export { SessionAgentMessageWriter } from "@/session/messages/SessionAgentMessageWriter.js";
export { SessionAgentActionPartWriter } from "@/session/messages/SessionAgentActionPartWriter.js";
export { normalize_session_user_parts } from "@/session/messages/SessionUserMessage.js";

/** 唯一 Session Message 写入服务。 */
export class SessionMessages {
  readonly session_id: string;
  private readonly store: SessionStorage;
  private readonly attachment_store: SessionAttachmentStore;
  private readonly publish: SessionMessagesOptions["publish"];
  private readonly messages_by_id = new Map<string, SessionMessage>();
  /** Assistant 草稿与 Interaction 的串行状态转换器。 */
  private readonly agent_state: SessionAgentMessageState;
  /** 当前 Message 恢复事务；并发初始化共享同一个 Promise。 */
  private initialize_promise: Promise<void> | null = null;

  constructor(options: SessionMessagesOptions) {
    this.session_id = String(options.session_id || "").trim();
    this.store = options.store;
    this.attachment_store = options.attachment_store;
    this.publish = options.publish;
    if (!this.session_id) throw new Error("SessionMessages requires session_id");
    this.agent_state = new SessionAgentMessageState({
      session_id: this.session_id,
      store: this.store,
      list_messages: () => this.messages_by_id.values(),
      accept_message: (message, publish_mutation) =>
        this.accept_message(message, publish_mutation),
      project_mutation: (mutation, message) =>
        this.accept_mutation(mutation, message),
    });
  }

  /** 恢复已有 Message，并收口进程中断遗留的运行状态。 */
  async initialize(): Promise<void> {
    if (!this.initialize_promise) {
      this.initialize_promise = this.restore_messages();
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
  }

  /** 只恢复非终态 Message，并由领域层统一收口进程中断状态。 */
  private async restore_messages(): Promise<void> {
    await this.store.initialize();
    const persisted_messages = await this.store.list_recoverable_agent_messages();
    this.messages_by_id.clear();
    for (const message of persisted_messages) {
      this.remember_message(message);
      const updated_at = Date.now();
      const recovered: SessionAgentMessage = {
        ...message,
        state: "done",
        revision: message.revision + 1,
        updated_at,
        parts: [...message.parts.map((part) => {
          if (part.type === "action" && part.state === "running") {
            return {
              ...part,
              state: "failed" as const,
              description: part.description || "Action interrupted before completion.",
            };
          }
          if (part.type === "tool") {
            const existing_interactions = part.interactions ?? [];
            const had_pending_interaction = existing_interactions.some(
              (interaction) => interaction.status === "pending",
            );
            const interactions = had_pending_interaction
              ? existing_interactions.map((interaction) =>
                  interaction.status === "pending"
                    ? {
                        ...interaction,
                        status: "cancelled" as const,
                        cancel_reason: "runtime_interrupted" as const,
                        resolved_at: updated_at,
                      }
                    : interaction,
                )
              : part.interactions;
            if (part.state === "completed" || part.state === "failed") {
              return had_pending_interaction ? { ...part, interactions } : part;
            }
            return {
              ...part,
              state: "failed" as const,
              error: "Tool interrupted before completion.",
              interactions,
            };
          }
          if (
            (part.type === "text" || part.type === "reasoning") &&
            part.state === "streaming"
          ) {
            return { ...part, state: "done" as const };
          }
          return part;
        }), {
          part_id: `error:${generate_id()}`,
          sequence: next_agent_part_sequence(message.parts),
          type: "error",
          scope: message.turn_id ? "turn" : "session",
          code: "runtime_interrupted",
          message: "Agent execution was interrupted before completion.",
          recoverable: true,
        }],
      };
      const changed_parts = resolve_changed_agent_parts(message.parts, recovered.parts);
      await this.store.update_message({
        message: recovered,
        expected_revision: message.revision,
        changed_parts,
      });
      this.accept_message(recovered, false);
    }
  }

  /** 同步读取当前内存 Message。 */
  get_message(message_id: string): SessionMessage | undefined {
    return this.messages_by_id.get(message_id);
  }

  /** 追加一条 canonical User Message。 */
  async append_user_message(
    input: AppendSessionUserMessageInput,
  ): Promise<SessionUserMessage> {
    const message_id =
      String(input.message_id || "").trim() ||
      `user:${this.session_id}:${generate_id()}`;
    const message = await this.create_message((sequence, created_at) => ({
      message_id,
      session_id: this.session_id,
      turn_id: input.turn_id,
      sequence,
      revision: 1,
      visibility: input.visibility || "visible",
      created_at,
      updated_at: created_at,
      role: "user",
      parts: normalize_canonical_session_user_parts(input.parts).map((part) => ({
        ...part,
        part_id: `${message_id}:part:${String(part.sequence)}`,
      })),
    }));
    if (message.role !== "user") {
      throw new Error(`User Message expected: ${message.message_id}`);
    }
    return message;
  }

  /** 创建可持续接收 chunk 的 Assistant Message。 */
  async open_agent_message(
    input: OpenSessionAgentMessageInput,
  ): Promise<SessionAgentMessageWriter> {
    const message = await this.create_message((sequence, created_at) => ({
      message_id:
        String(input.message_id || "").trim() ||
        `agent:${this.session_id}:${generate_id()}`,
      session_id: this.session_id,
      turn_id: input.turn_id,
      sequence,
      revision: 1,
      visibility: input.visibility || "visible",
      created_at,
      updated_at: created_at,
      role: "agent",
      state: "streaming",
      parts: [],
    }), true);
    return new SessionAgentMessageWriter(this, message.message_id);
  }

  /** 直接写入一条已完成 Assistant Message。 */
  async append_completed_agent_message(
    input: AppendCompletedAgentMessageInput,
  ): Promise<SessionAgentMessage> {
    const turn_id = input.turn_id || `external:${this.session_id}:${generate_id()}`;
    const writer = await this.open_agent_message({
      turn_id,
      visibility: input.visibility || "visible",
    });
    for (const part of input.parts) await writer.upsert_part(part);
    await writer.complete();
    const message = await this.store.read_message(writer.message_id);
    if (!message || message.role !== "agent") {
      throw new Error(`Completed Agent Message not found: ${writer.message_id}`);
    }
    return message;
  }

  /** 把公开 Session API 的 User 输入转换为 canonical Message 并持久化。 */
  async append_external_user_message(
    input: AppendExternalSessionUserMessageInput,
  ): Promise<boolean> {
    const source_parts = input.parts || [{
      type: "text" as const,
      text: String(input.text || "").trim(),
    }];
    const parts = normalize_session_user_parts(source_parts);
    if (parts.length === 0) return false;
    await this.append_user_message({
      turn_id: `external:${this.session_id}:${Date.now()}`,
      parts,
    });
    return true;
  }

  /** 把公开 Session API 的 Assistant 输入转换为 canonical Message 并持久化。 */
  async append_external_agent_message(
    input: AppendExternalSessionAgentMessageInput,
  ): Promise<boolean> {
    const parts = input.parts || [{
      type: "text" as const,
      text: String(input.text || "").trim(),
    }];
    if (!has_assistant_result_content(parts)) return false;
    const writer = await this.open_agent_message({
      turn_id: `external:${this.session_id}:${Date.now()}`,
    });
    await writer.append_result_parts(parts);
    await writer.complete();
    return true;
  }

  /** 把 Session prompt 转换为 canonical User Message 并持久化。 */
  async append_prompt_message(
    input: AppendSessionPromptMessageInput,
  ): Promise<SessionUserMessage> {
    const query = input.prompt.query;
    const ui_parts = typeof query === "string"
      ? [{ type: "text" as const, text: query.trim() }]
      : await persist_user_prompt_file_parts(
          Array.isArray(query) ? query : [],
          this.attachment_store,
        );
    const canonical = await this.append_user_message({
      turn_id: input.turn_id,
      parts: normalize_session_user_parts(ui_parts),
      ...(input.message_id ? { message_id: input.message_id } : {}),
    });
    return canonical;
  }

  /** 读取指定 Turn 最近一条 canonical Agent Message。 */
  async read_latest_agent_message(turn_id: string): Promise<SessionAgentMessage | null> {
    return await this.store.read_latest_agent_message(turn_id);
  }

  /**
   * 按稳定 Action ID 落盘一条 canonical Action。
   *
   * 关键点（中文）
   * - Action 属于仍在流式写的 Agent Message 时，Action Part 直接追加/更新到该
   *   Message，与正文共享同一条 canonical Message，避免执行期间出现割裂的独立气泡。
   * - 没有可写目标（Session 空闲、目标 Turn 尚未产生 Agent Message，或消息已收口）
   *   时，回退为只含 Action Part 的独立 Agent Message，保证 Action 始终可观测。
   */
  async persist_action(
    event: SessionActionEvent,
    options?: { publish_mutation?: boolean },
  ): Promise<void> {
    await this.ensure_initialized();
    const publish_mutation = options?.publish_mutation !== false;
    const streaming_target = event.turn_id
      ? this.find_streaming_agent_message(event.turn_id)
      : undefined;
    if (streaming_target) {
      await this.agent_state.commit_parts(
        streaming_target.message_id,
        [this.resolve_streaming_action_part(streaming_target, event)],
        { publish_mutation },
      );
      return;
    }
    const existing = this.get_message(event.action_id) ||
      await this.store.read_message(event.action_id) || undefined;
    if (!existing) {
      const writer = await this.open_action_part({
        message_id: event.action_id,
        turn_id: event.turn_id,
        action_type: event.action_type,
        title: event.title,
        description: event.description,
        publish_mutation,
      });
      if (event.status === "completed") await writer.complete();
      if (event.status === "failed") {
        await writer.fail(event.description || event.title);
      }
      return;
    }
    if (existing.role === "agent" && event.status !== "running") {
      await this.update_action_part(event.action_id, event.status, {
        title: event.title,
        description: event.description,
      }, { publish_mutation });
    }
  }

  /** 查找指定 Turn 当前仍在流式写的 canonical Agent Message（同一时刻至多一条）。 */
  private find_streaming_agent_message(turn_id: string): SessionAgentMessage | undefined {
    let latest: SessionAgentMessage | undefined;
    for (const message of this.messages_by_id.values()) {
      if (message.role !== "agent" || message.state !== "streaming") continue;
      if (message.turn_id !== turn_id) continue;
      if (!latest || message.sequence > latest.sequence) latest = message;
    }
    return latest;
  }

  /** 复用已有 Action Part 身份，为流式 Agent Message 构造对齐的 Action Part。 */
  private resolve_streaming_action_part(
    target: SessionAgentMessage,
    event: SessionActionEvent,
  ): SessionAgentActionPart {
    const part_id = `action-part:${event.action_id}`;
    const existing = target.parts.find(
      (part): part is SessionAgentActionPart =>
        part.type === "action" && part.part_id === part_id,
    );
    return create_action_part({
      action_id: event.action_id,
      part_id,
      sequence: existing?.sequence ?? next_agent_part_sequence(target.parts),
      action_type: event.action_type,
      state: event.status,
      title: event.title,
      description: event.description,
    });
  }

  /** 创建只包含 running Action Part 的 Agent Message。 */
  async open_action_part(
    input: OpenSessionAgentActionPartInput,
  ): Promise<SessionAgentActionPartWriter> {
    const message_id =
      String(input.message_id || "").trim() ||
      `agent-action:${this.session_id}:${generate_id()}`;
    const message = await this.create_message((sequence, created_at) => ({
      message_id,
      session_id: this.session_id,
      ...(input.turn_id ? { turn_id: input.turn_id } : {}),
      sequence,
      revision: 1,
      visibility: "visible",
      created_at,
      updated_at: created_at,
      role: "agent",
      state: "streaming",
      parts: [create_action_part({
        action_id: message_id,
        part_id: `action-part:${message_id}`,
        sequence: 1,
        action_type: input.action_type,
        state: "running",
        title: input.title,
        description: input.description,
        data: input.data,
      })],
    }), false, input.publish_mutation !== false);
    return new SessionAgentActionPartWriter(
      this,
      message.message_id,
      input.publish_mutation !== false,
    );
  }

  /** 更新 Action 状态，同时保持 message_id 与 sequence 不变。 */
  async update_action_part(
    message_id: string,
    status: "running" | "completed" | "failed",
    changes?: { title?: string; description?: string; data?: JsonObject },
    options?: { publish_mutation?: boolean },
  ): Promise<SessionAgentMessage> {
    const current_message = this.get_message(message_id) || await this.store.read_message(message_id);
    if (!current_message || current_message.role !== "agent") {
      throw new Error(`Session agent Message not found: ${message_id}`);
    }
    const action = current_message.parts.find(
        (part): part is SessionAgentActionPart => part.type === "action",
      );
    if (!action) throw new Error(`Session Action Part not found: ${message_id}`);
    const next_action: SessionAgentActionPart = {
      ...action,
      state: status,
      ...(changes?.title ? { title: changes.title } : {}),
      ...(changes?.description !== undefined
        ? { description: changes.description }
        : {}),
      ...(changes?.data ? { data: structuredClone(changes.data) } : {}),
    };
    const message: SessionAgentMessage = {
      ...current_message,
      state: status === "running" ? "streaming" : "done",
      parts: current_message.parts.map((part) =>
        part.part_id === action.part_id ? next_action : part),
      revision: current_message.revision + 1,
      updated_at: Date.now(),
    };
    await this.store.update_message({
      message,
      expected_revision: current_message.revision,
      changed_parts: [next_action],
    });
    this.accept_message(message, options?.publish_mutation !== false);
    return message;
  }

  /**
   * 将 Error Part 追加到当前 Turn 最后一个 Agent Message。
   *
   * 同一错误码已经存在时保持幂等；只有当前 Turn 从未产生 Agent Message 时，才创建
   * 一个仅含 Error 的失败 Message。这样错误与已经产生的 Text、Tool 和 Diff 始终
   * 共享同一 Message，并由 Part sequence 表达真实顺序。
   */
  async append_error_part(
    input: AppendSessionAgentErrorPartInput,
  ): Promise<SessionAgentMessage> {
    await this.ensure_initialized();
    const target = await this.store.read_latest_agent_message(input.turn_id);
    const existing_error = target?.parts.find(
      (part): part is SessionAgentErrorPart =>
        part.type === "error" && part.code === input.code,
    );
    if (target && existing_error) {
      return target;
    }

    const error_part: SessionAgentErrorPart = {
      part_id: `error:${generate_id()}`,
      sequence: target ? next_agent_part_sequence(target.parts) : 1,
      type: "error",
      scope: input.scope,
      code: input.code,
      message: input.message,
      recoverable: input.recoverable,
    };

    if (target?.state === "streaming") {
      this.remember_message(target);
      await this.agent_state.commit_parts(target.message_id, [error_part]);
      const updated = await this.store.read_message(target.message_id);
      if (!updated || updated.role !== "agent") {
        throw new Error(`Agent Message not found after Error Part commit: ${target.message_id}`);
      }
      return updated;
    }

    if (target) {
      const message: SessionAgentMessage = {
        ...target,
        revision: target.revision + 1,
        updated_at: Date.now(),
        parts: [...target.parts, error_part].sort(
          (left, right) => left.sequence - right.sequence,
        ),
      };
      await this.store.update_message({
        message,
        expected_revision: target.revision,
        changed_parts: [error_part],
      });
      this.accept_message(message);
      return message;
    }

    const message = await this.create_message((sequence, created_at) => ({
      message_id: `agent:${this.session_id}:${generate_id()}`,
      session_id: this.session_id,
      ...(input.turn_id ? { turn_id: input.turn_id } : {}),
      sequence,
      revision: 1,
      visibility: "visible",
      created_at,
      updated_at: created_at,
      role: "agent",
      state: "done",
      parts: [error_part],
    }));
    if (message.role !== "agent") {
      throw new Error(`Agent Message expected: ${message.message_id}`);
    }
    return message;
  }

  /** 按 Message sequence 返回一页完整 Message 聚合。 */
  async list_messages(
    input?: ListSessionMessagesInput,
  ): Promise<SessionMessagePage> {
    await this.ensure_initialized();
    const before_sequence = input?.before_sequence;
    if (
      before_sequence !== undefined &&
      (!Number.isInteger(before_sequence) || Number(before_sequence) <= 0)
    ) {
      throw new Error("before_sequence must be a positive integer");
    }
    const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200);
    const page = await this.store.list_message_page({
      ...(before_sequence !== undefined ? { before_sequence } : {}),
      limit: limit + 1,
      include_internal: input?.include_internal === true,
    });
    const has_more = page.length > limit;
    const messages = has_more ? page.slice(1) : page;
    const start_sequence = messages[0]?.sequence;
    const end_sequence = messages.at(-1)?.sequence;
    const stats = await this.store.message_stats();
    return {
      items: messages.map((message) => structuredClone(message)),
      total: stats.message_count,
      ...(start_sequence !== undefined ? { start_sequence } : {}),
      ...(end_sequence !== undefined ? { end_sequence } : {}),
      ...(has_more && start_sequence !== undefined
        ? { next_before_sequence: start_sequence }
        : {}),
      has_more,
    };
  }

  /** 读取全部真实历史，供 Fork 等明确的全量复制操作使用。 */
  async list_history_messages(): Promise<SessionMessage[]> {
    await this.ensure_initialized();
    return await this.store.list_messages();
  }

  /** 读取当前 Session 的存储统计。 */
  async storage_stats(): Promise<SessionMessageStorageStats> {
    await this.ensure_initialized();
    return await this.store.message_stats();
  }

  /** 向当前 Session 导入 fork 来源 Message，并重新分配全部身份和顺序。 */
  async import_messages(messages: SessionMessage[]): Promise<void> {
    const turn_ids = new Map<string, string>();
    const message_ids = new Map<string, string>();
    for (const source of [...messages].sort((a, b) => a.sequence - b.sequence)) {
      const turn_id = source.turn_id
        ? resolve_import_id(turn_ids, source.turn_id, "turn")
        : undefined;
      const message_id = resolve_import_id(
        message_ids,
        source.message_id,
        source.role,
      );
      await this.create_message((sequence, created_at) => ({
        ...structuredClone(source),
        message_id,
        session_id: this.session_id,
        ...(turn_id ? { turn_id } : {}),
        sequence,
        revision: 1,
        created_at,
        updated_at: created_at,
        origin: {
          session_id: source.session_id,
          message_id: source.message_id,
          ...(source.turn_id ? { turn_id: source.turn_id } : {}),
        },
      }));
    }
  }

  /** @internal 只向运行投影追加 Agent 文本 delta。 */
  project_agent_delta(
    message_id: string,
    part_id: string,
    type: "text" | "reasoning",
    delta: string,
  ): void {
    this.agent_state.project_delta(message_id, part_id, type, delta);
  }

  /** @internal 只向运行投影追加 Agent Tool 输入 delta。 */
  project_agent_tool_input_delta(
    message_id: string,
    part_id: string,
    tool_call_id: string,
    delta: string,
  ): void {
    this.agent_state.project_delta(
      message_id,
      part_id,
      "tool_input",
      delta,
      tool_call_id,
    );
  }

  /** @internal 只向运行投影写入 Agent 完整 Part。 */
  project_agent_part(
    message_id: string,
    part: SessionAgentMessagePart,
  ): void {
    this.agent_state.project_part(message_id, part);
  }

  /** @internal 原子提交当前运行投影。 */
  async checkpoint_agent_message(message_id: string): Promise<void> {
    await this.agent_state.checkpoint(message_id);
  }

  /** @internal 原子提交一组非流式 Agent Parts。 */
  async commit_agent_parts(
    message_id: string,
    parts: readonly SessionAgentMessagePart[],
  ): Promise<void> {
    await this.agent_state.commit_parts(message_id, parts);
  }

  /** @internal 丢弃未提交的当前 Step 投影。 */
  async rollback_agent_projection(message_id: string): Promise<void> {
    await this.agent_state.rollback_projection(message_id);
  }

  /** @internal 原子提交当前 Assistant step 的 metadata 快照。 */
  async commit_agent_step(
    message_id: string,
    parts: SessionAgentMessagePart[],
  ): Promise<void> {
    await this.agent_state.commit_step(message_id, parts);
  }

  /** @internal 收口 Assistant Message。 */
  async complete_agent_message(
    message_id: string,
    status: "completed" | "stopped" | "failed",
    error?: string,
  ): Promise<void> {
    await this.agent_state.complete(message_id, status, error);
  }

  private async create_message(
    factory: (sequence: number, created_at: number) => SessionMessage,
    draft = false,
    publish_mutation = true,
  ): Promise<SessionMessage> {
    await this.ensure_initialized();
    const message = await this.store.create_message((state) => {
      const candidate = factory(state.message_sequence, Date.now());
      if (draft && (candidate.role !== "agent" || candidate.state !== "streaming")) {
        throw new Error("Draft Message must be a streaming Agent Message");
      }
      return candidate;
    });
    this.accept_message(message, publish_mutation);
    return message;
  }

  /** 读取当前流式 Assistant 中的指定 Tool Part。 */
  find_streaming_tool(tool_call_id: string): SessionStreamingToolLocation | undefined {
    return this.agent_state.find_streaming_tool(tool_call_id);
  }

  /** 返回当前 Session 中全部等待用户响应的 canonical Interaction。 */
  list_pending_interactions(): SessionAgentInteraction[] {
    return this.agent_state.list_pending_interactions();
  }

  /** 原子创建 Interaction，并把关联 Tool 转为 waiting-user。 */
  async request_interaction(
    request: SessionInteractionRequest,
  ): Promise<SessionAgentInteraction> {
    return await this.agent_state.request_interaction(request);
  }

  /** 原子保存用户响应，并按 Interaction 结果恢复或终止关联 Tool。 */
  async resolve_interaction(
    interaction_id: string,
    response: SessionInteractionResponse,
  ): Promise<SessionAgentInteraction> {
    return await this.agent_state.resolve_interaction(
      interaction_id,
      response,
    );
  }

  /** 原子结束未响应 Interaction，并把关联 Tool 标记为失败。 */
  async close_interaction(
    interaction_id: string,
    input: SessionInteractionCloseInput,
  ): Promise<SessionAgentInteraction> {
    return await this.agent_state.close_interaction(interaction_id, input);
  }

  private build_message_mutation(message: SessionMessage): SessionMutation {
    const base = {
      mutation_id: generate_id(),
      variant: "message" as const,
      message_id: message.message_id,
      sequence: message.sequence,
      revision: message.revision,
      session_id: this.session_id,
      ...(message.turn_id ? { turn_id: message.turn_id } : {}),
      created_at: message.updated_at,
    };
    if (message.role === "agent") return { ...base, role: "agent", message };
    return { ...base, role: "user", message };
  }

  private build_part_mutation(
    message: SessionAgentMessage,
    part: SessionAgentMessagePart,
  ): SessionMutation {
    return create_session_part_mutation({
      mutation_id: generate_id(),
      session_id: this.session_id,
      message_id: message.message_id,
      ...(message.turn_id ? { turn_id: message.turn_id } : {}),
      revision: message.revision,
      created_at: message.updated_at,
      part,
    });
  }

  /**
   * 接受已持久化的 Message 快照。
   *
   * 发布形状由快照差异决定，调用方不需要描述“变化了什么”；
   * publish_mutation 为 false 时只更新运行投影。
   */
  private accept_message(message: SessionMessage, publish_mutation = true): void {
    const previous = this.get_message(message.message_id);
    this.remember_message(message);
    if (!publish_mutation) return;
    const change = project_message_change(previous, message);
    if (change.variant === "message") {
      this.publish(this.build_message_mutation(message));
      return;
    }
    for (const part of change.parts) this.publish(this.build_part_mutation(change.message, part));
  }

  private accept_mutation(mutation: SessionMutation, message: SessionMessage): void {
    this.remember_message(message);
    this.publish(mutation);
  }

  /** 仅缓存可变的 streaming Agent Message；终态历史始终读取 SQLite。 */
  private remember_message(message: SessionMessage): void {
    this.messages_by_id.delete(message.message_id);
    if (message.role === "agent" && message.state === "streaming") {
      this.messages_by_id.set(message.message_id, structuredClone(message));
    }
  }

  private async ensure_initialized(): Promise<void> {
    await this.initialize();
  }

}

/** 一个 Message 快照相对上一稳定状态的最小变更投影。 */
type SessionMessageChange =
  | { variant: "message" }
  | { variant: "part"; message: SessionAgentMessage; parts: SessionAgentMessagePart[] };

/**
 * 将一次 Message 提交投影为最小突变。
 *
 * Part Mutation 是「按 part_id 替换」，既无法让消费方建立一条尚不存在的 Message，
 * 也无法表达 Part 消失。所以首次出现、User Message、state 收口与 Part 被移除都必须
 * 整条发布；其余情况只发布发生变化的 Part，不重传整条会话。
 */
function project_message_change(
  previous: SessionMessage | undefined,
  message: SessionMessage,
): SessionMessageChange {
  if (
    previous?.role !== "agent" ||
    message.role !== "agent" ||
    previous.state !== message.state ||
    previous.parts.some(
      (part) => !message.parts.some((next) => next.part_id === part.part_id)
    )
  ) {
    return { variant: "message" };
  }
  return {
    variant: "part",
    message,
    parts: resolve_changed_agent_parts(previous.parts, message.parts),
  };
}

function resolve_import_id(map: Map<string, string>, source_id: string, prefix: string): string {
  const existing = map.get(source_id);
  if (existing) return existing;
  const created = `${prefix}:${generate_id()}`;
  map.set(source_id, created);
  return created;
}

/** 构造一个 canonical Action Part。 */
function create_action_part(input: {
  /** Action 稳定业务标识。 */
  action_id: string;
  /** Part 在所属 Message 内的稳定标识。 */
  part_id: string;
  /** Part 在所属 Message 内的顺序号。 */
  sequence: number;
  /** Action 业务类别。 */
  action_type: string;
  /** Action 生命周期状态。 */
  state: SessionActionStatus;
  /** Action 展示标题。 */
  title: string;
  /** Action 展示描述。 */
  description?: string;
  /** Action 结构化附加数据。 */
  data?: JsonObject;
}): SessionAgentActionPart {
  return {
    part_id: input.part_id,
    sequence: input.sequence,
    type: "action",
    action_id: input.action_id,
    action_type: input.action_type,
    state: input.state,
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    ...(input.data ? { data: structuredClone(input.data) } : {}),
  };
}

