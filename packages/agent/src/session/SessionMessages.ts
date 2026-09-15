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
import {
  has_assistant_result_content,
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
  SessionMessage,
  SessionMessagePage,
  SessionUserMessage,
  SessionUserMessagePart,
} from "@downcity/type";
import { SessionMessageCache } from "@/session/messages/SessionMessageCache.js";
import { resolve_session_message_state } from "@/session/messages/SessionMessageState.js";
import {
  next_agent_part_sequence,
  resolve_changed_agent_parts,
} from "@/session/messages/SessionAgentParts.js";
import type { SessionMessageStorageStats } from "@/types/store/SessionStorage.js";
import type {
  SessionInteractionCloseInput,
  SessionInteractionRequest,
  SessionInteractionResponse,
} from "@downcity/type";
import type { SessionActionEvent } from "@downcity/type";
import { persist_user_prompt_file_parts } from "@executor/messages/SessionAttachmentMapper.js";
import type {
  AppendExternalSessionAgentMessageInput,
  AppendExternalSessionUserMessageInput,
  AppendSessionAgentErrorPartInput,
  AppendSessionPromptMessageInput,
  AppendSessionUserMessageInput,
  OpenSessionAgentMessageInput,
  SessionMessagesOptions,
} from "@/types/session/SessionMessages.js";
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import type { SessionAttachmentStore } from "@/types/store/SessionAttachmentStore.js";

export { SessionAgentMessageWriter } from "@/session/messages/SessionAgentMessageWriter.js";
export { normalize_session_user_parts } from "@/session/messages/SessionUserMessage.js";

/** 唯一 Session Message 写入服务。 */
export class SessionMessages {
  readonly session_id: string;
  private readonly store: SessionStorage;
  private readonly attachment_store: SessionAttachmentStore;
  /** Message 运行缓存与 Mutation 发布边界。 */
  private readonly cache: SessionMessageCache;
  /** Assistant 草稿与 Interaction 的串行状态转换器。 */
  private readonly agent_state: SessionAgentMessageState;
  /** 当前 Message 恢复事务；并发初始化共享同一个 Promise。 */
  private initialize_promise: Promise<void> | null = null;

  constructor(options: SessionMessagesOptions) {
    this.session_id = String(options.session_id || "").trim();
    this.store = options.store;
    this.attachment_store = options.attachment_store;
    if (!this.session_id) throw new Error("SessionMessages requires session_id");
    this.cache = new SessionMessageCache({
      session_id: this.session_id,
      publish: options.publish,
    });
    this.agent_state = new SessionAgentMessageState({
      session_id: this.session_id,
      store: this.store,
      cache: this.cache,
    });
  }

  /** 该 Message 是否仍由未收口的 writer 持有；终态推导与 Action 归属共同依赖它。 */
  private is_held_by_writer(message_id: string): boolean {
    return this.cache.is_held(message_id);
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
    for (const message of persisted_messages) {
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
      // 恢复不属于本次订阅范围，只更新内存事实，不发布 Mutation。
      this.cache.accept(recovered, false);
    }
  }

  /** 同步读取当前内存 Message。 */
  get_message(message_id: string): SessionMessage | undefined {
    return this.cache.get(message_id);
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
      // 调用方只提供内容；part_id 是全局主键，必须在这里统一分配。
      parts: input.parts.map((part, index) => ({
        ...structuredClone(part),
        sequence: index + 1,
        part_id: `${message_id}:part:${String(index + 1)}`,
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
    const message_id =
      String(input.message_id || "").trim() ||
      `agent:${this.session_id}:${generate_id()}`;
    // 先建立持有关系，创建消息时的首次接受才会被登记为可写 Message。
    const writer = new SessionAgentMessageWriter({
      message_id,
      state: this.agent_state,
      cache: this.cache,
    });
    this.cache.set_held(message_id);
    try {
      await this.create_message((sequence, created_at) => ({
        message_id,
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
    } catch (error) {
      this.cache.release_held(message_id);
      throw error;
    }
    return writer;
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
   * 判定顺序固定，三分支互斥：
   * 1. 该 Turn 存在 writer 持有的正文 Message → Action 作为其 Part 内联；
   * 2. 否则存在 id 等于 action_id 的载体 Message → 原地更新其中的 Action Part；
   * 3. 否则新建仅含该 Action Part 的载体 Message。
   *
   * 三个分支都只写 Part，Message 终态统一由 SessionMessageState 推导。
   */
  async persist_action(
    event: SessionActionEvent,
    options?: { publish_mutation?: boolean },
  ): Promise<void> {
    await this.ensure_initialized();
    const publish_mutation = options?.publish_mutation !== false;
    const body = event.turn_id ? this.find_open_message(event.turn_id) : undefined;
    if (body) {
      await this.agent_state.commit_parts(
        body.message_id,
        [this.resolve_streaming_action_part(body, event)],
        { publish_mutation },
      );
      return;
    }
    const existing = this.get_message(event.action_id) ||
      await this.store.read_message(event.action_id) || undefined;
    if (!existing) {
      await this.create_standalone_action_message(event, publish_mutation);
      return;
    }
    if (existing.role === "agent" && event.status !== "running") {
      await this.update_action_part(event.action_id, event.status, {
        title: event.title,
        description: event.description,
      }, { publish_mutation });
    }
  }

  /** 查找指定 Turn 当前由 writer 持有的正文 Message（同一时刻至多一条）。 */
  private find_open_message(turn_id: string): SessionAgentMessage | undefined {
    const message_id = this.cache.held_message_id();
    if (!message_id) return undefined;
    const message = this.get_message(message_id);
    if (!message || message.role !== "agent" || message.turn_id !== turn_id) {
      return undefined;
    }
    return message;
  }

  /** 复用已有 Action Part 身份，为被 writer 持有的 Agent Message 构造对齐的 Action Part。 */
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

  /**
   * 创建只包含单个 Action Part 的独立 Agent Message。
   *
   * 只在当前 Turn 没有 writer 持有的 Agent Message 时使用；Action Part 直接以事件声明的
   * 目标状态落盘，不再先建后改，避免同一个 Action 产生两次 Mutation。
   */
  private async create_standalone_action_message(
    event: SessionActionEvent,
    publish_mutation: boolean,
  ): Promise<void> {
    const description = event.description ??
      (event.status === "failed" ? event.title : undefined);
    const parts = [create_action_part({
      action_id: event.action_id,
      part_id: `action-part:${event.action_id}`,
      sequence: 1,
      action_type: event.action_type,
      state: event.status,
      title: event.title,
      ...(description ? { description } : {}),
    })];
    await this.create_message((sequence, created_at) => ({
      message_id: event.action_id,
      session_id: this.session_id,
      ...(event.turn_id ? { turn_id: event.turn_id } : {}),
      sequence,
      revision: 1,
      visibility: "visible",
      created_at,
      updated_at: created_at,
      role: "agent",
      state: resolve_session_message_state(parts, false),
      parts,
    }), event.status === "running", publish_mutation);
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
    const next_parts = current_message.parts.map((part) =>
      part.part_id === action.part_id ? next_action : part);
    const message: SessionAgentMessage = {
      ...current_message,
      state: resolve_session_message_state(
        next_parts,
        this.is_held_by_writer(message_id),
      ),
      parts: next_parts,
      revision: current_message.revision + 1,
      updated_at: Date.now(),
    };
    await this.store.update_message({
      message,
      expected_revision: current_message.revision,
      changed_parts: [next_action],
    });
    this.cache.accept(message, options?.publish_mutation !== false);
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

    if (target && this.is_held_by_writer(target.message_id)) {
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
      this.cache.accept(message);
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
      state: resolve_session_message_state([error_part], false),
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
    const total = await this.store.message_count();
    return {
      items: messages.map((message) => structuredClone(message)),
      total,
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
    this.cache.accept(message, publish_mutation);
    return message;
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

  private async ensure_initialized(): Promise<void> {
    await this.initialize();
  }
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

