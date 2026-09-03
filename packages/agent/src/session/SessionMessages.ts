/**
 * SessionMessages：Session Message 的唯一领域入口。
 *
 * 完整 Message 与 Assistant 草稿先持久化，成功后再发布实时 Mutation。
 * 同一 Assistant Message 的流式、审批与关闭操作共享一条写队列，保证 revision
 * 从最新快照严格递增。
 */

import type {
  SessionAssistantResultPart,
  SessionPromptPart,
} from "@/types/session/SessionContent.js";
import { generate_id } from "@/utils/Id.js";
import { SessionAssistantMessageWriter } from "@/session/messages/SessionAssistantMessageWriter.js";
import { SessionMessageInteractionWriter } from "@/session/messages/SessionMessageInteractionWriter.js";
import { to_session_json_value } from "@/session/messages/SessionJsonValue.js";
import type { JsonObject } from "@/types/common/Json.js";
import type {
  ListSessionMessagesInput,
  SessionActionMessage,
  SessionAssistantInteractionPart,
  SessionAssistantMessage,
  SessionAssistantMessagePart,
  SessionAssistantToolPart,
  SessionErrorMessage,
  SessionMessage,
  SessionMessagePage,
  SessionUserMessage,
  SessionUserMessagePart,
} from "@/types/session/SessionMessage.js";
import type {
  SessionMutation,
  SessionMessageMutation as SessionMessageSnapshotMutation,
} from "@/types/session/SessionMutation.js";
import type {
  SessionContextSnapshot,
  SessionMessageStorageStats,
  SessionSegmentSummary,
} from "@/types/session/SessionSegment.js";
import type { SessionStreamingToolLocation } from "@/types/session/SessionTool.js";
import type {
  SessionInteractionRequest,
  SessionInteractionResponse,
} from "@/types/session/SessionInteraction.js";
import type { SessionActionEvent } from "@/types/session/SessionAction.js";
import { persist_user_prompt_file_parts } from "@executor/messages/SessionAttachmentMapper.js";
import {
  normalize_session_context_content,
  normalize_session_context_tag,
} from "@/session/messages/SessionUserContext.js";
import type {
  AppendCompletedAssistantMessageInput,
  AppendExternalSessionAssistantMessageInput,
  AppendExternalSessionUserMessageInput,
  AppendSessionErrorMessageInput,
  AppendSessionPromptMessageInput,
  AppendSessionUserMessageInput,
  OpenSessionActionMessageInput,
  OpenSessionAssistantMessageInput,
  SessionMessagesOptions,
} from "@/types/session/SessionMessages.js";
import type { SessionMessageStore } from "@/types/store/SessionDataStore.js";
import type { SessionAttachmentStore } from "@/types/store/SessionAttachmentStore.js";

export { SessionAssistantMessageWriter } from "@/session/messages/SessionAssistantMessageWriter.js";

/** 唯一 Session Message 写入服务。 */
export class SessionMessages {
  readonly session_id: string;
  private readonly store: SessionMessageStore;
  private readonly attachment_store: SessionAttachmentStore;
  private readonly publish: SessionMessagesOptions["publish"];
  private readonly messages_by_id = new Map<string, SessionMessage>();
  /** 按 Assistant Message 隔离的完整写事务链。 */
  private readonly assistant_write_chains = new Map<string, Promise<void>>();
  /** Assistant Message 内 Interaction Part 的原子状态写入器。 */
  private readonly interaction_writer: SessionMessageInteractionWriter;
  private initialized = false;

  constructor(options: SessionMessagesOptions) {
    this.session_id = String(options.session_id || "").trim();
    this.store = options.store;
    this.attachment_store = options.attachment_store;
    this.publish = options.publish;
    if (!this.session_id) throw new Error("SessionMessages requires session_id");
    this.interaction_writer = new SessionMessageInteractionWriter({
      list_messages: () => this.messages_by_id.values(),
      find_streaming_tool: (tool_call_id) => this.find_streaming_tool(tool_call_id),
      enqueue_assistant_write: (message_id, operation) =>
        this.enqueue_assistant_write(message_id, operation),
      commit_assistant_snapshot: (current, parts) =>
        this.commit_assistant_snapshot(current, parts),
    });
  }

  /** 恢复已有 Message，并收口进程中断遗留的运行状态。 */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.store.initialize();
    for (const message of await this.store.list_messages()) {
      this.messages_by_id.set(message.message_id, message);
    }
    this.initialized = true;
    const unfinished = [...this.messages_by_id.values()];
    for (const message of unfinished) {
      if (message.type === "assistant" && message.status === "streaming") {
        await this.complete_assistant_message(message.message_id, "stopped");
      }
      if (message.type === "action" && message.status === "running") {
        await this.update_action_message(message.message_id, "failed", {
          description: message.description || "Action interrupted before completion.",
        });
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
  async open_assistant_message(
    input: OpenSessionAssistantMessageInput,
  ): Promise<SessionAssistantMessageWriter> {
    const message = (await this.create_message((sequence, created_at) => ({
      message_id:
        String(input.message_id || "").trim() ||
        `assistant:${this.session_id}:${generate_id()}`,
      session_id: this.session_id,
      turn_id: input.turn_id,
      sequence,
      revision: 1,
      visibility: input.visibility || "visible",
      created_at,
      updated_at: created_at,
      type: "assistant",
      kind: input.kind || "normal",
      status: "streaming",
      parts: [],
      ...(input.summary_through_message_id
        ? { summary_through_message_id: input.summary_through_message_id }
        : {}),
    }), true)) as SessionAssistantMessage;
    return new SessionAssistantMessageWriter(this, message.message_id);
  }

  /** 直接写入一条已完成 Assistant Message。 */
  async append_completed_assistant_message(
    input: AppendCompletedAssistantMessageInput,
  ): Promise<SessionAssistantMessage> {
    const turn_id = input.turn_id || `external:${this.session_id}:${generate_id()}`;
    const writer = await this.open_assistant_message({
      turn_id,
      kind: input.kind || "normal",
      visibility: input.visibility || "visible",
      ...(input.summary_through_message_id
        ? { summary_through_message_id: input.summary_through_message_id }
        : {}),
    });
    for (const part of input.parts) await writer.upsert_part(part);
    await writer.complete();
    return this.get_message(writer.message_id) as SessionAssistantMessage;
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
  async append_external_assistant_message(
    input: AppendExternalSessionAssistantMessageInput,
  ): Promise<boolean> {
    const parts = input.parts || [{
      type: "text" as const,
      text: String(input.text || "").trim(),
    }];
    if (!has_assistant_result_content(parts)) return false;
    const writer = await this.open_assistant_message({
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
      const writer = await this.open_action_message({
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
    if (existing.type === "action" && event.status !== "running") {
      await this.update_action_message(event.action_id, event.status, {
        title: event.title,
        description: event.description,
      }, { publish_mutation });
    }
  }

  /** 创建 running Action Message。 */
  async open_action_message(
    input: OpenSessionActionMessageInput,
  ): Promise<SessionActionMessageWriter> {
    const message = (await this.create_message((sequence, created_at) => ({
      message_id:
        String(input.message_id || "").trim() ||
        `action:${this.session_id}:${generate_id()}`,
      session_id: this.session_id,
      ...(input.turn_id ? { turn_id: input.turn_id } : {}),
      sequence,
      revision: 1,
      visibility: "visible",
      created_at,
      updated_at: created_at,
      type: "action",
      action_type: input.action_type,
      status: "running",
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      ...(input.data ? { data: structuredClone(input.data) } : {}),
    }), false, input.publish_mutation !== false)) as SessionActionMessage;
    return new SessionActionMessageWriter(
      this,
      message.message_id,
      input.publish_mutation !== false,
    );
  }

  /** 更新 Action 状态，同时保持 message_id 与 sequence 不变。 */
  async update_action_message(
    message_id: string,
    status: "running" | "completed" | "failed",
    changes?: { title?: string; description?: string; data?: JsonObject },
    options?: { publish_mutation?: boolean },
  ): Promise<SessionActionMessage> {
    const message = await this.store.append_message((state) => {
      const current = require_message(state.messages, message_id, "action");
      const created_at = Date.now();
      return {
        ...current,
        status,
        ...(changes?.title ? { title: changes.title } : {}),
        ...(changes?.description !== undefined
          ? { description: changes.description }
          : {}),
        ...(changes?.data ? { data: structuredClone(changes.data) } : {}),
        revision: current.revision + 1,
        updated_at: created_at,
      } satisfies SessionActionMessage;
    });
    this.accept_message(message, options?.publish_mutation !== false);
    return message as SessionActionMessage;
  }

  /** 创建用户可见 Error Message。 */
  async append_error_message(
    input: AppendSessionErrorMessageInput,
  ): Promise<SessionErrorMessage> {
    return (await this.create_message((sequence, created_at) => ({
      message_id: `error:${this.session_id}:${generate_id()}`,
      session_id: this.session_id,
      ...(input.turn_id ? { turn_id: input.turn_id } : {}),
      sequence,
      revision: 1,
      visibility: "visible",
      created_at,
      updated_at: created_at,
      type: "error",
      scope: input.scope,
      code: input.code,
      message: input.message,
      recoverable: input.recoverable,
    }))) as SessionErrorMessage;
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
  async append_assistant_delta(
    message_id: string,
    part_id: string,
    type: "text" | "reasoning",
    delta: string,
  ): Promise<void> {
    if (!delta) return;
    await this.enqueue_assistant_write(message_id, async () => {
      await this.append_assistant_delta_serialized(message_id, part_id, type, delta);
    });
  }

  /** 在 Assistant 写队列内追加文本 delta。 */
  private async append_assistant_delta_serialized(
    message_id: string,
    part_id: string,
    type: "text" | "reasoning",
    delta: string,
  ): Promise<void> {
    const current = require_message([...this.messages_by_id.values()], message_id, "assistant");
    require_streaming_assistant(current);
    const part = current.parts.find((item) => item.part_id === part_id);
    if (!part || (part.type !== "text" && part.type !== "reasoning")) {
      throw new Error(`Delta target Part does not exist: ${part_id}`);
    }
    if (part.type !== type) throw new Error(`Delta type changed for Part: ${part_id}`);
    const created_at = Date.now();
    const message: SessionAssistantMessage = {
      ...current,
      revision: current.revision + 1,
      updated_at: created_at,
      parts: current.parts.map((item) =>
        item.part_id === part_id && (item.type === "text" || item.type === "reasoning")
          ? { ...item, text: item.text + delta }
          : item,
      ),
    };
    await this.store.write_assistant_message(message);
    this.accept_mutation({
      mutation_id: generate_id(),
      variant: "delta",
      type,
      message_id,
      revision: message.revision,
      session_id: this.session_id,
      turn_id: message.turn_id,
      created_at,
      part_id,
      delta,
    }, message);
  }

  /** @internal 写入 Assistant Tool 输入原始 delta。 */
  async append_assistant_tool_input_delta(
    message_id: string,
    part_id: string,
    tool_call_id: string,
    delta: string,
  ): Promise<void> {
    if (!delta) return;
    await this.enqueue_assistant_write(message_id, async () => {
      const current = require_message(
        [...this.messages_by_id.values()],
        message_id,
        "assistant",
      );
      require_streaming_assistant(current);
      const part = current.parts.find((item) => item.part_id === part_id);
      if (!part || part.type !== "tool") {
        throw new Error(`Tool input Delta target Part does not exist: ${part_id}`);
      }
      if (part.tool_call_id !== tool_call_id) {
        throw new Error(`Tool input Delta tool_call_id changed for Part: ${part_id}`);
      }
      if (part.state !== "input-streaming") {
        throw new Error(`Tool input Delta cannot update ${part.state} Part: ${part_id}`);
      }
      const created_at = Date.now();
      const message: SessionAssistantMessage = {
        ...current,
        revision: current.revision + 1,
        updated_at: created_at,
        parts: current.parts.map((item) =>
          item.part_id === part_id && item.type === "tool"
            ? { ...item, input_text: `${item.input_text || ""}${delta}` }
            : item,
        ),
      };
      await this.store.write_assistant_message(message);
      this.accept_mutation({
        mutation_id: generate_id(),
        variant: "delta",
        type: "tool_input",
        message_id,
        revision: message.revision,
        session_id: this.session_id,
        turn_id: message.turn_id,
        created_at,
        part_id,
        tool_call_id,
        delta,
      }, message);
    });
  }

  /** @internal 写入 Assistant 完整 part。 */
  async update_assistant_part(
    message_id: string,
    part: SessionAssistantMessagePart,
  ): Promise<void> {
    await this.enqueue_assistant_write(message_id, async () => {
      await this.update_assistant_part_serialized(message_id, part);
    });
  }

  /** 在 Assistant 写队列内提交完整 Part 快照。 */
  private async update_assistant_part_serialized(
    message_id: string,
    part: SessionAssistantMessagePart,
  ): Promise<void> {
    const current = require_message([...this.messages_by_id.values()], message_id, "assistant");
    require_streaming_assistant(current);
    const existing = current.parts.find((item) => item.part_id === part.part_id);
    if (existing && existing.sequence !== part.sequence) {
      throw new Error(`Assistant Part sequence changed: ${part.part_id}`);
    }
    const created_at = Date.now();
    const next_part = structuredClone(part);
    const message: SessionAssistantMessage = {
      ...current,
      revision: current.revision + 1,
      updated_at: created_at,
      parts: (existing
        ? current.parts.map((item) => item.part_id === part.part_id ? next_part : item)
        : [...current.parts, next_part]
      ).sort((left, right) => left.sequence - right.sequence),
    };
    await this.store.write_assistant_message(message);
    this.accept_mutation({
      mutation_id: generate_id(),
      variant: "part",
      type: next_part.type,
      message_id,
      revision: message.revision,
      session_id: this.session_id,
      turn_id: message.turn_id,
      created_at,
      part_id: next_part.part_id,
      part: next_part,
    } as SessionMutation, message);
  }

  /** @internal 原子提交当前 Assistant step 的 metadata 快照。 */
  async commit_assistant_step(
    message_id: string,
    parts: SessionAssistantMessagePart[],
  ): Promise<void> {
    await this.enqueue_assistant_write(message_id, async () => {
      const current = require_message([...this.messages_by_id.values()], message_id, "assistant");
      require_streaming_assistant(current);
      if (
        parts.length !== current.parts.length ||
        parts.some((part, index) =>
          part.part_id !== current.parts[index]?.part_id ||
          part.sequence !== current.parts[index]?.sequence
        )
      ) {
        throw new Error(
          `Assistant step changed canonical Part identity: ${message_id}`,
        );
      }
      const created_at = Date.now();
      const message: SessionAssistantMessage = {
        ...current,
        revision: current.revision + 1,
        updated_at: created_at,
        parts: structuredClone(parts),
      };
      await this.store.write_assistant_message(message);
      this.accept_message(message);
    });
  }

  /** @internal 收口 Assistant Message。 */
  async complete_assistant_message(
    message_id: string,
    status: "completed" | "stopped" | "failed",
    error?: string,
  ): Promise<void> {
    await this.enqueue_assistant_write(message_id, async () => {
      await this.complete_assistant_message_serialized(message_id, status, error);
    });
  }

  /** 在 Assistant 写队列内关闭草稿并写入 Active。 */
  private async complete_assistant_message_serialized(
    message_id: string,
    status: "completed" | "stopped" | "failed",
    error?: string,
  ): Promise<void> {
    const current = require_message([...this.messages_by_id.values()], message_id, "assistant");
    require_streaming_assistant(current);
    const created_at = Date.now();
    const interrupted_interactions = status === "stopped"
      ? current.parts.filter(
          (part): part is SessionAssistantInteractionPart =>
            part.type === "interaction" && part.status === "pending",
        )
      : [];
    const interrupted_tool_ids = new Set(
      interrupted_interactions.flatMap((part) =>
        part.request.source.tool_call_id
          ? [part.request.source.tool_call_id]
          : [],
      ),
    );
    const message: SessionAssistantMessage = {
      ...current,
      revision: current.revision + 1,
      status,
      updated_at: created_at,
      parts: current.parts.map((part) => {
        if (part.type === "text" || part.type === "reasoning") {
          return { ...part, state: "done" as const };
        }
        if (part.type === "interaction" && part.status === "pending") {
          return {
            ...part,
            status: "cancelled" as const,
            cancel_reason: "runtime_interrupted" as const,
            resolved_at: created_at,
          };
        }
        if (
          part.type === "tool" &&
          part.state !== "completed" &&
          part.state !== "failed"
        ) {
          return {
            ...part,
            state: "failed" as const,
            error:
              status === "stopped" &&
              part.state === "waiting-user" &&
              interrupted_tool_ids.has(part.tool_call_id)
                ? "Interaction cancelled"
                : error || "Tool did not complete before Assistant Message closed",
          };
        }
        return part;
      }),
    };
    await this.store.finalize_assistant_message(message);
    this.accept_message(message);
  }

  private async create_message(
    factory: (sequence: number, created_at: number) => SessionMessage,
    draft = false,
    publish_mutation = true,
  ): Promise<SessionMessage> {
    await this.ensure_initialized();
    if (draft) {
      const message = await this.store.create_assistant_message((state) => {
        const candidate = factory(state.message_sequence, Date.now());
        if (candidate.type !== "assistant" || candidate.status !== "streaming") {
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
    for (const message of this.messages_by_id.values()) {
      if (message.type !== "assistant" || message.status !== "streaming") continue;
      const part = message.parts.find(
        (item): item is SessionAssistantToolPart =>
          item.type === "tool" && item.tool_call_id === tool_call_id,
      );
      if (part) return { message_id: message.message_id, part };
    }
    return undefined;
  }

  /** 返回当前 Session 中全部等待用户响应的 canonical Interaction。 */
  list_pending_interactions(): SessionAssistantInteractionPart[] {
    return this.interaction_writer.list_pending();
  }

  /** 原子创建 Interaction，并把关联 Tool 转为 waiting-user。 */
  async request_interaction(
    request: SessionInteractionRequest,
  ): Promise<SessionAssistantInteractionPart> {
    return this.interaction_writer.request(request);
  }

  /** 原子保存用户响应，并按 Interaction 结果恢复或终止关联 Tool。 */
  async resolve_interaction(
    interaction_id: string,
    response: SessionInteractionResponse,
  ): Promise<SessionAssistantInteractionPart> {
    return this.interaction_writer.resolve(interaction_id, response);
  }

  /** 原子结束未响应 Interaction，并把关联 Tool 标记为失败。 */
  async close_interaction(
    interaction_id: string,
    input:
      | { status: "expired" }
      | {
          status: "cancelled";
          reason: "turn_stopped" | "session_disposed" | "runtime_interrupted";
        },
  ): Promise<SessionAssistantInteractionPart> {
    return this.interaction_writer.close(interaction_id, input);
  }

  /**
   * 串行执行同一 Assistant Message 的完整写事务。
   *
   * 失败事务不会阻塞后续写入；链尾仅用于排序，真实错误仍返回给调用方。
   */
  private async enqueue_assistant_write<T>(
    message_id: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.assistant_write_chains.get(message_id) || Promise.resolve();
    const result = previous.then(operation, operation);
    const chain = result.then(() => undefined, () => undefined);
    this.assistant_write_chains.set(message_id, chain);
    try {
      return await result;
    } finally {
      if (this.assistant_write_chains.get(message_id) === chain) {
        this.assistant_write_chains.delete(message_id);
      }
    }
  }

  /** 原子提交包含多个 Part 状态变化的 Assistant 完整快照。 */
  private async commit_assistant_snapshot(
    current: SessionAssistantMessage,
    parts: SessionAssistantMessagePart[],
  ): Promise<void> {
    const created_at = Date.now();
    const message: SessionAssistantMessage = {
      ...current,
      revision: current.revision + 1,
      updated_at: created_at,
      parts: structuredClone(parts).sort(
        (left, right) => left.sequence - right.sequence,
      ),
    };
    await this.store.write_assistant_message(message);
    const current_by_id = new Map(
      current.parts.map((part) => [part.part_id, part]),
    );
    const changed_parts = message.parts.filter((part) => {
      const previous = current_by_id.get(part.part_id);
      return !previous || JSON.stringify(previous) !== JSON.stringify(part);
    });
    if (changed_parts.length === 0) {
      this.accept_message(message);
      return;
    }
    for (const part of changed_parts) {
      this.accept_mutation({
        mutation_id: generate_id(),
        variant: "part",
        type: part.type,
        message_id: message.message_id,
        revision: message.revision,
        session_id: this.session_id,
        turn_id: message.turn_id,
        created_at,
        part_id: part.part_id,
        part: structuredClone(part),
      } as SessionMutation, message);
    }
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
    if (!this.initialized) await this.initialize();
  }

}
/** 单个 Action Message 的生命周期 writer。 */
export class SessionActionMessageWriter {
  readonly message_id: string;
  private readonly messages: SessionMessages;
  private readonly publish_mutation: boolean;
  private closed = false;

  constructor(
    messages: SessionMessages,
    message_id: string,
    publish_mutation = true,
  ) {
    this.messages = messages;
    this.message_id = message_id;
    this.publish_mutation = publish_mutation;
  }

  /** 把 Action 更新为 completed。 */
  async complete(input?: { title?: string; description?: string; data?: JsonObject }): Promise<void> {
    if (this.closed) return;
    await this.messages.update_action_message(
      this.message_id,
      "completed",
      input,
      { publish_mutation: this.publish_mutation },
    );
    this.closed = true;
  }

  /** 把 Action 更新为 failed。 */
  async fail(error: unknown): Promise<void> {
    if (this.closed) return;
    await this.messages.update_action_message(
      this.message_id,
      "failed",
      {
        description: error instanceof Error ? error.message : String(error),
      },
      { publish_mutation: this.publish_mutation },
    );
    this.closed = true;
  }
}

/** 把 Downcity Session User parts 归一为 canonical User parts。 */
export function normalize_session_user_parts(
  parts: SessionPromptPart[] | null | undefined,
): SessionUserMessagePart[] {
  if (!Array.isArray(parts)) return [];
  return parts.flatMap<SessionUserMessagePart>((part, index) => {
    if (part.type === "text") {
      return [{
        part_id: `user-text:${index + 1}`,
        type: "text",
        text: part.text,
        state: "done",
      }];
    }
    if (part.type === "context") {
      return [{
        part_id: `user-context:${index + 1}`,
        type: "context",
        tag: normalize_session_context_tag(part.tag),
        context: normalize_session_context_content(part.context),
      }];
    }
    if (part.type === "file") {
      return [{
        part_id: `user-file:${index + 1}`,
        type: "file",
        url: part.url,
        media_type: part.media_type,
        ...(part.filename ? { filename: part.filename } : {}),
      }];
    }
    return [{
      part_id: `user-data:${index + 1}`,
      type: "data",
      data_type: part.data_type,
      data: to_session_json_value(part.data),
      ...(part.data_id ? { data_id: part.data_id } : {}),
    }];
  });
}

/** 校验直接写入的 canonical User Parts，并保留已有 Part identity。 */
function normalize_canonical_session_user_parts(
  parts: readonly SessionUserMessagePart[],
): SessionUserMessagePart[] {
  return parts.map((part) => {
    const canonical = structuredClone(part);
    if (canonical.type !== "context") return canonical;
    return {
      ...canonical,
      tag: normalize_session_context_tag(canonical.tag),
      context: normalize_session_context_content(canonical.context),
    };
  });
}

/** 判断 Assistant 结果中是否包含可持久化内容。 */
function has_assistant_result_content(
  parts: readonly SessionAssistantResultPart[],
): boolean {
  return parts.some((part) => {
    if (part.type === "text") return Boolean(part.text.trim());
    if (part.type === "file") return Boolean(part.media_type.trim() && part.url.trim());
    return Boolean(part.data_type.trim());
  });
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

function require_streaming_assistant(
  message: SessionMessage,
): SessionAssistantMessage {
  if (message.type !== "assistant") {
    throw new Error(`Session Message is not assistant: ${message.message_id}`);
  }
  if (message.status !== "streaming") {
    throw new Error(`Assistant Message is already closed: ${message.message_id}`);
  }
  return message;
}

function resolve_import_id(map: Map<string, string>, source_id: string, prefix: string): string {
  const existing = map.get(source_id);
  if (existing) return existing;
  const created = `${prefix}:${generate_id()}`;
  map.set(source_id, created);
  return created;
}

/** 从 Action Message ID 提取稳定业务类型。 */
function infer_action_type(message_id: string): string {
  return String(message_id || "").split(":")[0] || "action";
}

/** 按真实 Message sequence 升序排序。 */
function compare_message_sequence(left: SessionMessage, right: SessionMessage): number {
  return left.sequence - right.sequence;
}
