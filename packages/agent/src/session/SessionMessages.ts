/**
 * SessionMessages：Session Message 的唯一领域入口。
 *
 * 完整 Message 与 Assistant 草稿先持久化，成功后再发布实时 Mutation。
 * 同一 Assistant Message 的流式、审批与关闭操作共享一条写队列，保证 revision
 * 从最新快照严格递增。
 */

import type { UIMessage } from "ai";
import { generate_id } from "@/utils/Id.js";
import { SessionAssistantMessageWriter } from "@/session/messages/SessionAssistantMessageWriter.js";
import { to_session_json_value } from "@/session/messages/SessionJsonValue.js";
import type { JsonObject } from "@/types/common/Json.js";
import type {
  ListSessionMessagesInput,
  SessionActionMessage,
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
import type { SessionApproval } from "@/types/session/SessionApproval.js";
import type {
  SessionActionRecordV1,
  SessionRecordV1,
  SessionUserMessageV1,
} from "@/executor/types/SessionRecords.js";
import { is_session_action_record } from "@/executor/types/SessionRecords.js";
import {
  from_ui_assistant_parts,
  from_ui_user_parts,
  to_executor_ui_message,
} from "@/session/messages/SessionMessageCodec.js";
import { hydrateUserPromptFileParts } from "@executor/messages/SessionAttachmentMapper.js";
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
import type { SessionMessageStore } from "@/types/store/SessionStore.js";

export { SessionAssistantMessageWriter } from "@/session/messages/SessionAssistantMessageWriter.js";

/** 唯一 Session Message 写入服务。 */
export class SessionMessages {
  readonly session_id: string;
  private readonly store: SessionMessageStore;
  private readonly publish: SessionMessagesOptions["publish"];
  private readonly messages_by_id = new Map<string, SessionMessage>();
  /** 按 Assistant Message 隔离的完整写事务链。 */
  private readonly assistant_write_chains = new Map<string, Promise<void>>();
  private initialized = false;

  constructor(options: SessionMessagesOptions) {
    this.session_id = String(options.session_id || "").trim();
    this.store = options.store;
    this.publish = options.publish;
    if (!this.session_id) throw new Error("SessionMessages requires session_id");
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
      parts: structuredClone(input.parts),
    }));
    return message as SessionUserMessage;
  }

  /** 创建可持续接收 chunk 的 Assistant segment。 */
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
      segment_index: input.segment_index,
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
      segment_index: 1,
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

  /** 把内部 Executor Record 收口为 canonical Session Message。 */
  async append_record(record: SessionRecordV1): Promise<void> {
    if (is_session_action_record(record)) {
      const action = record as SessionActionRecordV1;
      const existing = this.get_message(action.id);
      if (existing?.type === "action") {
        if (action.state !== "running") {
          await this.update_action_message(action.id, action.state, {
            title: action.title,
            description: action.description,
          });
        }
        return;
      }
      const writer = await this.open_action_message({
        message_id: action.id,
        turn_id: action.metadata.turn_id,
        action_type: String(action.id || "").split(":")[0] || "action",
        title: action.title,
        description: action.description,
      });
      if (action.state === "completed") await writer.complete();
      if (action.state === "failed") {
        await writer.fail(action.description || action.title);
      }
      return;
    }

    const turn_id = String(
      record.metadata?.turn_id || `external:${this.session_id}:${generate_id()}`,
    );
    if (record.role === "user") {
      await this.append_user_message({
        turn_id,
        input_type:
          record.metadata?.extra?.inputType === "steer" ? "steer" : "prompt",
        parts: from_ui_user_parts(record.parts),
      });
      return;
    }
    await this.append_completed_assistant_message({
      turn_id,
      parts: from_ui_assistant_parts(record.parts),
      visibility:
        record.metadata?.extra?.visibility === "internal"
          ? "internal"
          : "visible",
      kind: record.metadata?.kind === "summary" ? "summary" : "normal",
    });
  }

  /** 把公开 Session API 的 User 输入转换为 canonical Message 并持久化。 */
  async append_external_user_message(
    input: AppendExternalSessionUserMessageInput,
  ): Promise<boolean> {
    const parts = input.message && "role" in input.message
      ? from_ui_user_parts(input.message.parts)
      : [{
          part_id: `external-user-text:${Date.now()}`,
          type: "text" as const,
          text: String(input.text || "").trim(),
          state: "done" as const,
        }];
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
    const parts = input.message && "role" in input.message
      ? from_ui_assistant_parts(input.message.parts)
      : [{
          part_id: `external-assistant-text:${Date.now()}`,
          sequence: 1,
          type: "text" as const,
          text: String(input.fallback_text || "").trim(),
          state: "done" as const,
        }];
    if (parts.length === 0) return false;
    await this.append_completed_assistant_message({ parts });
    return true;
  }

  /** 把 Session prompt 转换为 canonical User Message 并持久化。 */
  async append_prompt_message(
    input: AppendSessionPromptMessageInput,
  ): Promise<SessionUserMessageV1> {
    const query = input.prompt.query;
    const ui_parts = typeof query === "string"
      ? [{ type: "text" as const, text: query.trim() }]
      : await hydrateUserPromptFileParts(
          Array.isArray(query) ? query : [],
          input.project_root,
        );
    const canonical = await this.append_user_message({
      turn_id: input.turn_id,
      input_type: input.input_type,
      parts: normalize_session_user_parts(ui_parts),
    });
    return to_executor_ui_message(canonical) as SessionUserMessageV1;
  }

  /** 持久化 Executor 在本轮延迟产生的 User Message。 */
  async append_deferred_user_messages(
    deferred_messages?: SessionUserMessageV1[],
  ): Promise<number> {
    const messages = Array.isArray(deferred_messages)
      ? deferred_messages
      : [];
    for (const message of messages) {
      await this.append_user_message({
        turn_id: String(
          message.metadata?.turn_id ||
            `deferred:${this.session_id}:${Date.now()}`,
        ),
        input_type: "steer",
        parts: from_ui_user_parts(message.parts),
      });
    }
    return messages.length;
  }

  /** 按稳定 Action ID 创建或更新 canonical Action Message。 */
  async persist_action_record(event: SessionActionRecordV1): Promise<void> {
    const existing = this.get_message(event.id);
    if (!existing) {
      const writer = await this.open_action_message({
        message_id: event.id,
        turn_id: event.metadata.turn_id,
        action_type: infer_action_type(event.id),
        title: event.title,
        description: event.description,
      });
      if (event.state === "completed") await writer.complete();
      if (event.state === "failed") {
        await writer.fail(event.description || event.title);
      }
      return;
    }
    if (existing.type === "action" && event.state !== "running") {
      await this.update_action_message(event.id, event.state, {
        title: event.title,
        description: event.description,
      });
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
    }))) as SessionActionMessage;
    return new SessionActionMessageWriter(this, message.message_id);
  }

  /** 更新 Action 状态，同时保持 message_id 与 sequence 不变。 */
  async update_action_message(
    message_id: string,
    status: "running" | "completed" | "failed",
    changes?: { title?: string; description?: string; data?: JsonObject },
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
    this.accept_message(message);
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
  ): Promise<void> {
    await this.enqueue_assistant_write(message_id, async () => {
      await this.complete_assistant_message_serialized(message_id, status);
    });
  }

  /** 在 Assistant 写队列内关闭草稿并写入 Active。 */
  private async complete_assistant_message_serialized(
    message_id: string,
    status: "completed" | "stopped" | "failed",
  ): Promise<void> {
    const current = require_message([...this.messages_by_id.values()], message_id, "assistant");
    require_streaming_assistant(current);
    const created_at = Date.now();
    const message: SessionAssistantMessage = {
      ...current,
      revision: current.revision + 1,
      status,
      updated_at: created_at,
      parts: current.parts.map((part) =>
        part.type === "text" || part.type === "reasoning"
          ? { ...part, state: "done" as const }
          : part,
      ),
    };
    await this.store.finalize_assistant_message(message);
    this.accept_message(message);
  }

  private async create_message(
    factory: (sequence: number, created_at: number) => SessionMessage,
    draft = false,
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
      this.accept_message(message);
      return message;
    }
    const message = await this.store.append_message((state) =>
      factory(state.message_sequence, Date.now()),
    );
    this.accept_message(message);
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

  /** 把完整审批请求写入对应的流式 Tool Part。 */
  async request_tool_approval(approval: SessionApproval): Promise<void> {
    const { message_id } = this.require_streaming_tool(approval.tool_call_id);
    await this.enqueue_assistant_write(message_id, async () => {
      const tool = this.require_streaming_tool(approval.tool_call_id);
      if (tool.message_id !== message_id) {
        throw new Error(`Tool Assistant Message changed: ${approval.tool_call_id}`);
      }
      if (tool.part.state !== "ready") {
        throw new Error(
          `Tool approval requires ready input: ${approval.tool_call_id} (${tool.part.state})`,
        );
      }
      await this.update_assistant_part_serialized(message_id, {
        ...tool.part,
        state: "approval-required",
        approval: {
          approval_id: approval.approval_id,
          request: approval,
        },
      });
    });
  }

  /** 在 Tool 恢复执行前提交审批决定对应的 Part 状态。 */
  async resolve_tool_approval(input: {
    /** 当前审批请求标识。 */
    approval_id: string;
    /** 当前审批最终决定。 */
    decision: "approved" | "denied" | "expired";
    /** 当前审批关联的 Tool Call。 */
    tool_call_id: string;
  }): Promise<void> {
    const { message_id } = this.require_streaming_tool(input.tool_call_id);
    await this.enqueue_assistant_write(message_id, async () => {
      const tool = this.require_streaming_tool(input.tool_call_id);
      if (tool.message_id !== message_id) {
        throw new Error(`Tool Assistant Message changed: ${input.tool_call_id}`);
      }
      if (tool.part.approval?.approval_id !== input.approval_id) {
        throw new Error(`Tool approval identity mismatch: ${input.approval_id}`);
      }
      await this.update_assistant_part_serialized(message_id, {
        ...tool.part,
        state: input.decision === "approved" ? "running" : "failed",
        approval: {
          ...tool.part.approval,
          approval_id: input.approval_id,
          approved: input.decision === "approved",
          ...(input.decision === "expired"
            ? { reason: "Approval expired" }
            : input.decision === "denied"
              ? { reason: "Approval denied" }
              : {}),
        },
        ...(input.decision === "approved"
          ? {}
          : {
              error:
                input.decision === "expired"
                  ? "Approval expired"
                  : "Approval denied",
            }),
      });
    });
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

  /** 查找当前流式 Assistant 中的 Tool Part，否则抛出明确错误。 */
  private require_streaming_tool(tool_call_id: string): SessionStreamingToolLocation {
    const tool = this.find_streaming_tool(tool_call_id);
    if (tool) return tool;
    throw new Error(`Streaming Tool Part not found: ${tool_call_id}`);
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

  private accept_message(message: SessionMessage): void {
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
  private closed = false;

  constructor(messages: SessionMessages, message_id: string) {
    this.messages = messages;
    this.message_id = message_id;
  }

  /** 把 Action 更新为 completed。 */
  async complete(input?: { title?: string; description?: string; data?: JsonObject }): Promise<void> {
    if (this.closed) return;
    await this.messages.update_action_message(this.message_id, "completed", input);
    this.closed = true;
  }

  /** 把 Action 更新为 failed。 */
  async fail(error: unknown): Promise<void> {
    if (this.closed) return;
    await this.messages.update_action_message(this.message_id, "failed", {
      description: error instanceof Error ? error.message : String(error),
    });
    this.closed = true;
  }
}

/** 把 AI SDK User parts 归一为 canonical User parts。 */
export function normalize_session_user_parts(
  parts: UIMessage["parts"] | null | undefined,
): SessionUserMessagePart[] {
  if (!Array.isArray(parts)) return [];
  return parts.flatMap<SessionUserMessagePart>((part, index) => {
    if (!part || typeof part !== "object") return [];
    const candidate = part as Record<string, unknown>;
    if (candidate.type === "text") {
      return [{
        part_id: `user-text:${index + 1}`,
        type: "text",
        text: String(candidate.text || ""),
        state: "done",
      }];
    }
    if (candidate.type === "file") {
      return [{
        part_id: `user-file:${index + 1}`,
        type: "file",
        url: String(candidate.url || ""),
        media_type: String(candidate.mediaType || "application/octet-stream"),
        ...(candidate.filename ? { filename: String(candidate.filename) } : {}),
      }];
    }
    if (String(candidate.type || "").startsWith("data-")) {
      return [{
        part_id: `user-data:${index + 1}`,
        type: "data",
        data_type: String(candidate.type),
        data: to_session_json_value(candidate.data),
      }];
    }
    return [];
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
