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
  SessionAgentActionPart,
  SessionAgentErrorPart,
  SessionAgentInteractionPart,
  SessionAgentMessage,
  SessionAgentMessagePart,
  SessionMessage,
  SessionMessagePage,
  SessionUserMessage,
  SessionUserMessagePart,
} from "@downcity/type";
import type {
  SessionMutation,
  SessionMessageMutation as SessionMessageSnapshotMutation,
} from "@downcity/type";
import type {
  SessionContextSnapshot,
  SessionMessageStorageStats,
  SessionSegmentSummary,
} from "@/types/session/SessionSegment.js";
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
import type { SessionMessageStore } from "@/types/store/SessionDataStore.js";
import type { SessionAttachmentStore } from "@/types/store/SessionAttachmentStore.js";

export { SessionAgentMessageWriter } from "@/session/messages/SessionAgentMessageWriter.js";
export { SessionAgentActionPartWriter } from "@/session/messages/SessionAgentActionPartWriter.js";
export { normalize_session_user_parts } from "@/session/messages/SessionUserMessage.js";

/** 唯一 Session Message 写入服务。 */
export class SessionMessages {
  readonly session_id: string;
  private readonly store: SessionMessageStore;
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
      accept_mutation: (mutation, message) =>
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

  /** 执行一次完整恢复，并收口进程中断遗留的运行状态。 */
  private async restore_messages(): Promise<void> {
    await this.store.initialize();
    const persisted_messages = await this.store.list_messages();
    this.messages_by_id.clear();
    for (const message of persisted_messages) {
      this.messages_by_id.set(message.message_id, message);
    }
    const unfinished = [...this.messages_by_id.values()];
    for (const message of unfinished) {
      if (message.type === "agent" && message.status === "streaming") {
        await this.complete_agent_message(message.message_id, "stopped");
      }
      if (message.type === "agent") {
        for (const part of message.parts) {
          if (part.type !== "action" || part.state !== "running") continue;
          await this.update_action_part(message.message_id, "failed", {
            description:
              part.description || "Action interrupted before completion.",
          });
        }
      }
    }
  }

  /** 同步读取当前内存 Message。 */
  get_message(message_id: string): SessionMessage | undefined {
    return this.messages_by_id.get(message_id);
  }

  /** 追加普通 prompt 或 steering User Message。 */
  async append_user_message(
    input: AppendSessionUserMessageInput,
  ): Promise<SessionUserMessage> {
    const message = await this.create_message((sequence, created_at) => ({
      message_id:
        String(input.message_id || "").trim() ||
        `user:${this.session_id}:${generate_id()}`,
      session_id: this.session_id,
      turn_id: input.turn_id,
      sequence,
      revision: 1,
      visibility: input.visibility || "visible",
      created_at,
      updated_at: created_at,
      type: "user",
      input_type: input.input_type,
      parts: normalize_canonical_session_user_parts(input.parts),
    }));
    return message as SessionUserMessage;
  }

  /** 创建可持续接收 chunk 的 Assistant Message。 */
  async open_agent_message(
    input: OpenSessionAgentMessageInput,
  ): Promise<SessionAgentMessageWriter> {
    const message = (await this.create_message((sequence, created_at) => ({
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
      type: "agent",
      kind: input.kind || "normal",
      status: "streaming",
      parts: [],
      ...(input.summary_through_message_id
        ? { summary_through_message_id: input.summary_through_message_id }
        : {}),
    }), true)) as SessionAgentMessage;
    return new SessionAgentMessageWriter(this, message.message_id);
  }

  /** 直接写入一条已完成 Assistant Message。 */
  async append_completed_agent_message(
    input: AppendCompletedAgentMessageInput,
  ): Promise<SessionAgentMessage> {
    const turn_id = input.turn_id || `external:${this.session_id}:${generate_id()}`;
    const writer = await this.open_agent_message({
      turn_id,
      kind: input.kind || "normal",
      visibility: input.visibility || "visible",
      ...(input.summary_through_message_id
        ? { summary_through_message_id: input.summary_through_message_id }
        : {}),
    });
    for (const part of input.parts) await writer.upsert_part(part);
    await writer.complete();
    return this.get_message(writer.message_id) as SessionAgentMessage;
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
      input_type: "prompt",
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
      input_type: input.input_type,
      parts: normalize_session_user_parts(ui_parts),
    });
    return canonical;
  }

  /** 持久化 Executor 在本轮延迟产生的 User Message。 */
  async append_deferred_user_messages(
    deferred_messages?: SessionUserMessage[],
  ): Promise<number> {
    const messages = Array.isArray(deferred_messages)
      ? deferred_messages
      : [];
    for (const message of messages) {
      await this.append_user_message({
        turn_id: message.turn_id || `deferred:${this.session_id}:${Date.now()}`,
        input_type: "steer",
        parts: structuredClone(message.parts),
      });
    }
    return messages.length;
  }

  /** 按稳定 Action ID 创建或更新 canonical Action Message。 */
  async persist_action(
    event: SessionActionEvent,
    options?: { publish_mutation?: boolean },
  ): Promise<void> {
    const publish_mutation = options?.publish_mutation !== false;
    const existing = this.get_message(event.action_id);
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
    if (existing.type === "agent" && event.status !== "running") {
      await this.update_action_part(event.action_id, event.status, {
        title: event.title,
        description: event.description,
      }, { publish_mutation });
    }
  }

  /** 创建只包含 running Action Part 的 Agent Message。 */
  async open_action_part(
    input: OpenSessionAgentActionPartInput,
  ): Promise<SessionAgentActionPartWriter> {
    const message_id =
      String(input.message_id || "").trim() ||
      `agent-action:${this.session_id}:${generate_id()}`;
    const message = (await this.create_message((sequence, created_at) => ({
      message_id,
      session_id: this.session_id,
      ...(input.turn_id ? { turn_id: input.turn_id } : {}),
      sequence,
      revision: 1,
      visibility: "visible",
      created_at,
      updated_at: created_at,
      type: "agent",
      kind: "normal",
      status: "completed",
      parts: [{
        part_id: `action-part:${message_id}`,
        sequence: 1,
        type: "action",
        action_id: message_id,
        action_type: input.action_type,
        state: "running",
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        ...(input.data ? { data: structuredClone(input.data) } : {}),
      }],
    }), false, input.publish_mutation !== false)) as SessionAgentMessage;
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
    const message = await this.store.append_message((state) => {
      const current = require_message(state.messages, message_id, "agent");
      const action = current.parts.find(
        (part): part is SessionAgentActionPart => part.type === "action",
      );
      if (!action) throw new Error(`Session Action Part not found: ${message_id}`);
      const created_at = Date.now();
      return {
        ...current,
        parts: current.parts.map((part) => part.part_id === action.part_id
          ? {
              ...action,
              state: status,
              ...(changes?.title ? { title: changes.title } : {}),
              ...(changes?.description !== undefined
                ? { description: changes.description }
                : {}),
              ...(changes?.data ? { data: structuredClone(changes.data) } : {}),
            }
          : part),
        revision: current.revision + 1,
        updated_at: created_at,
      } satisfies SessionAgentMessage;
    });
    this.accept_message(message, options?.publish_mutation !== false);
    return message as SessionAgentMessage;
  }

  /** 创建只包含 Error Part 的用户可见 Agent Message。 */
  async append_error_part(
    input: AppendSessionAgentErrorPartInput,
  ): Promise<SessionAgentMessage> {
    return (await this.create_message((sequence, created_at) => ({
      message_id: `agent:${this.session_id}:${generate_id()}`,
      session_id: this.session_id,
      ...(input.turn_id ? { turn_id: input.turn_id } : {}),
      sequence,
      revision: 1,
      visibility: "visible",
      created_at,
      updated_at: created_at,
      type: "agent",
      kind: "normal",
      status: "failed",
      parts: [{
        part_id: `error:${generate_id()}`,
        sequence: 1,
        type: "error",
        scope: input.scope,
        code: input.code,
        message: input.message,
        recoverable: input.recoverable,
      } satisfies SessionAgentErrorPart],
    }))) as SessionAgentMessage;
  }

  /** 读取 Active 或指定边界之前最近的完整 Segment。 */
  async list_messages(
    input?: ListSessionMessagesInput,
  ): Promise<SessionMessagePage> {
    await this.ensure_initialized();
    const requests_segment = input?.before_sequence !== undefined;
    const before_sequence = input?.before_sequence;
    if (
      requests_segment &&
      (!Number.isInteger(before_sequence) || Number(before_sequence) <= 0)
    ) {
      throw new Error("before_sequence must be a positive integer");
    }
    const segment = requests_segment
      ? await this.store.read_segment_before(Number(before_sequence))
      : null;
    const source = requests_segment ? "segment" as const : "active" as const;
    const messages = requests_segment
      ? segment?.messages || []
      : [...this.messages_by_id.values()].sort(compare_message_sequence);
    const start_sequence = messages[0]?.sequence;
    const end_sequence = messages.at(-1)?.sequence;
    const history_boundary = source === "segment"
      ? segment?.range.start_sequence
      : await this.store.active_before_sequence(messages);
    const has_more = history_boundary !== undefined &&
      await this.store.has_segment_before(history_boundary);
    const stats = await this.store.stats();
    const items = messages
      .filter((message) => input?.include_internal === true || message.visibility === "visible")
      .map((message) => structuredClone(message));
    return {
      items,
      total: stats.message_count,
      source,
      ...(start_sequence !== undefined ? { start_sequence } : {}),
      ...(end_sequence !== undefined ? { end_sequence } : {}),
      ...(has_more && history_boundary !== undefined
        ? { next_before_sequence: history_boundary }
        : {}),
      has_more,
    };
  }

  /** 读取最新累计 Summary 与全部 Active Message，供模型上下文使用。 */
  async context_snapshot(): Promise<SessionContextSnapshot> {
    await this.ensure_initialized();
    return {
      summary: await this.store.read_latest_summary(),
      messages: [...this.messages_by_id.values()]
        .sort(compare_message_sequence)
        .map((message) => structuredClone(message)),
    };
  }

  /** 读取全部真实历史，供 Fork 等明确的全量复制操作使用。 */
  async list_history_messages(): Promise<SessionMessage[]> {
    await this.ensure_initialized();
    return await this.store.list_history_messages();
  }

  /** 读取当前 Session 的存储统计。 */
  async storage_stats(): Promise<SessionMessageStorageStats> {
    await this.ensure_initialized();
    return await this.store.stats();
  }

  /** 把 Active 前缀和累计 Summary 提交为不可变 Segment。 */
  async compact_active(input: {
    /** 移入 Segment 的最后一条真实 Message sequence。 */
    through_sequence: number;
    /** 写入 Segment footer 的累计 Summary。 */
    summary: SessionSegmentSummary;
  }): Promise<void> {
    await this.ensure_initialized();
    const result = await this.store.compact_active(input);
    this.messages_by_id.clear();
    for (const message of result.active_messages) {
      this.messages_by_id.set(message.message_id, structuredClone(message));
    }
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
        source.type,
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

  /** @internal 写入 Assistant 原始文本 delta。 */
  async append_agent_delta(
    message_id: string,
    part_id: string,
    type: "text" | "reasoning",
    delta: string,
  ): Promise<void> {
    await this.agent_state.append_delta(message_id, part_id, type, delta);
  }

  /** @internal 写入 Assistant Tool 输入原始 delta。 */
  async append_agent_tool_input_delta(
    message_id: string,
    part_id: string,
    tool_call_id: string,
    delta: string,
  ): Promise<void> {
    await this.agent_state.append_tool_input_delta(
      message_id,
      part_id,
      tool_call_id,
      delta,
    );
  }

  /** @internal 写入 Assistant 完整 part。 */
  async update_agent_part(
    message_id: string,
    part: SessionAgentMessagePart,
  ): Promise<void> {
    await this.agent_state.update_part(message_id, part);
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
    if (draft) {
      const message = await this.store.create_agent_message((state) => {
        const candidate = factory(state.message_sequence, Date.now());
        if (candidate.type !== "agent" || candidate.status !== "streaming") {
          throw new Error("Draft Message must be a streaming Assistant");
        }
        return candidate;
      });
      this.accept_message(message, publish_mutation);
      return message;
    }
    const message = await this.store.append_message((state) =>
      factory(state.message_sequence, Date.now()),
    );
    this.accept_message(message, publish_mutation);
    return message;
  }

  /** 读取当前流式 Assistant 中的指定 Tool Part。 */
  find_streaming_tool(tool_call_id: string): SessionStreamingToolLocation | undefined {
    return this.agent_state.find_streaming_tool(tool_call_id);
  }

  /** 返回当前 Session 中全部等待用户响应的 canonical Interaction。 */
  list_pending_interactions(): SessionAgentInteractionPart[] {
    return this.agent_state.list_pending_interactions();
  }

  /** 原子创建 Interaction，并把关联 Tool 转为 waiting-user。 */
  async request_interaction(
    request: SessionInteractionRequest,
  ): Promise<SessionAgentInteractionPart> {
    return await this.agent_state.request_interaction(request);
  }

  /** 原子保存用户响应，并按 Interaction 结果恢复或终止关联 Tool。 */
  async resolve_interaction(
    interaction_id: string,
    response: SessionInteractionResponse,
  ): Promise<SessionAgentInteractionPart> {
    return await this.agent_state.resolve_interaction(
      interaction_id,
      response,
    );
  }

  /** 原子结束未响应 Interaction，并把关联 Tool 标记为失败。 */
  async close_interaction(
    interaction_id: string,
    input: SessionInteractionCloseInput,
  ): Promise<SessionAgentInteractionPart> {
    return await this.agent_state.close_interaction(interaction_id, input);
  }

  private build_message_mutation(
    message: SessionMessage,
  ): SessionMessageSnapshotMutation {
    return {
      mutation_id: generate_id(),
      variant: "message",
      type: message.type,
      message_id: message.message_id,
      sequence: message.sequence,
      revision: message.revision,
      session_id: this.session_id,
      ...(message.turn_id ? { turn_id: message.turn_id } : {}),
      created_at: message.updated_at,
      message,
    } as SessionMessageSnapshotMutation;
  }

  private accept_message(message: SessionMessage, publish_mutation = true): void {
    if (!publish_mutation) {
      this.messages_by_id.set(message.message_id, structuredClone(message));
      return;
    }
    this.accept_mutation(this.build_message_mutation(message), message);
  }

  private accept_mutation(mutation: SessionMutation, message: SessionMessage): void {
    this.messages_by_id.set(message.message_id, structuredClone(message));
    this.publish(mutation);
  }

  private async ensure_initialized(): Promise<void> {
    await this.initialize();
  }

}

function require_message<TType extends SessionMessage["type"]>(
  messages: SessionMessage[],
  message_id: string,
  type: TType,
): Extract<SessionMessage, { type: TType }> {
  const message = messages.find((item) => item.message_id === message_id);
  if (!message || message.type !== type) {
    throw new Error(`Session ${type} Message not found: ${message_id}`);
  }
  return message as Extract<SessionMessage, { type: TType }>;
}

function resolve_import_id(map: Map<string, string>, source_id: string, prefix: string): string {
  const existing = map.get(source_id);
  if (existing) return existing;
  const created = `${prefix}:${generate_id()}`;
  map.set(source_id, created);
  return created;
}

/** 按真实 Message sequence 升序排序。 */
function compare_message_sequence(left: SessionMessage, right: SessionMessage): number {
  return left.sequence - right.sequence;
}
