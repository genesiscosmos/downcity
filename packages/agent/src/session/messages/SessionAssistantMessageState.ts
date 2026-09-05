/**
 * canonical Assistant Message 的串行状态转换器。
 *
 * 关键点（中文）
 * - 只拥有每条 Assistant Message 的临时写事务链，不拥有 Message 事实源。
 * - 所有草稿、Part、Interaction 与终态都先持久化，再交回 SessionMessages 接受。
 * - 同一 Assistant Message 的 revision 严格串行，不同 Message 可以并行推进。
 */

import { generate_id } from "@/utils/Id.js";
import { SessionMessageInteractionWriter } from "@/session/messages/SessionMessageInteractionWriter.js";
import type {
  SessionAssistantInteractionPart,
  SessionAssistantMessage,
  SessionAssistantMessagePart,
  SessionAssistantToolPart,
  SessionMessage,
} from "@/types/session/SessionMessage.js";
import type {
  SessionInteractionCloseInput,
  SessionInteractionRequest,
  SessionInteractionResponse,
} from "@/types/session/SessionInteraction.js";
import type { SessionStreamingToolLocation } from "@/types/session/SessionTool.js";
import type { SessionMutation } from "@/types/session/SessionMutation.js";
import type { SessionAssistantMessageStateOptions } from "@/types/session/SessionAssistantMessageState.js";

/** 管理 Assistant 草稿、Part 与 Interaction 的原子状态转换。 */
export class SessionAssistantMessageState {
  private readonly session_id: string;
  private readonly options: SessionAssistantMessageStateOptions;
  /** 按 Assistant Message 隔离的完整写事务链。 */
  private readonly write_chains = new Map<string, Promise<void>>();
  /** Assistant Message 内 Interaction Part 的原子状态写入器。 */
  private readonly interaction_writer: SessionMessageInteractionWriter;

  constructor(options: SessionAssistantMessageStateOptions) {
    this.session_id = options.session_id;
    this.options = options;
    this.interaction_writer = new SessionMessageInteractionWriter({
      list_messages: options.list_messages,
      find_streaming_tool: (tool_call_id) => this.find_streaming_tool(tool_call_id),
      enqueue_assistant_write: (message_id, operation) =>
        this.enqueue_write(message_id, operation),
      commit_assistant_snapshot: (current, parts) =>
        this.commit_snapshot(current, parts),
    });
  }

  /** 写入 Assistant 原始文本 delta。 */
  async append_delta(
    message_id: string,
    part_id: string,
    type: "text" | "reasoning",
    delta: string,
  ): Promise<void> {
    if (!delta) return;
    await this.enqueue_write(message_id, async () => {
      const current = this.require_streaming_assistant(message_id);
      const part = current.parts.find((item) => item.part_id === part_id);
      if (!part || (part.type !== "text" && part.type !== "reasoning")) {
        throw new Error(`Delta target Part does not exist: ${part_id}`);
      }
      if (part.type !== type) {
        throw new Error(`Delta type changed for Part: ${part_id}`);
      }
      const created_at = Date.now();
      const message: SessionAssistantMessage = {
        ...current,
        revision: current.revision + 1,
        updated_at: created_at,
        parts: current.parts.map((item) =>
          item.part_id === part_id &&
              (item.type === "text" || item.type === "reasoning")
            ? { ...item, text: item.text + delta }
            : item,
        ),
      };
      await this.options.store.write_assistant_message(message);
      this.options.accept_mutation({
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
    });
  }

  /** 写入 Assistant Tool 输入原始 delta。 */
  async append_tool_input_delta(
    message_id: string,
    part_id: string,
    tool_call_id: string,
    delta: string,
  ): Promise<void> {
    if (!delta) return;
    await this.enqueue_write(message_id, async () => {
      const current = this.require_streaming_assistant(message_id);
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
      await this.options.store.write_assistant_message(message);
      this.options.accept_mutation({
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

  /** 提交一个完整 canonical Assistant Part。 */
  async update_part(
    message_id: string,
    part: SessionAssistantMessagePart,
  ): Promise<void> {
    await this.enqueue_write(message_id, async () => {
      const current = this.require_streaming_assistant(message_id);
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
          ? current.parts.map((item) =>
              item.part_id === part.part_id ? next_part : item)
          : [...current.parts, next_part]
        ).sort((left, right) => left.sequence - right.sequence),
      };
      await this.options.store.write_assistant_message(message);
      this.options.accept_mutation({
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
    });
  }

  /** 原子提交当前 Assistant step 的 metadata 快照。 */
  async commit_step(
    message_id: string,
    parts: SessionAssistantMessagePart[],
  ): Promise<void> {
    await this.enqueue_write(message_id, async () => {
      const current = this.require_streaming_assistant(message_id);
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
      const message: SessionAssistantMessage = {
        ...current,
        revision: current.revision + 1,
        updated_at: Date.now(),
        parts: structuredClone(parts),
      };
      await this.options.store.write_assistant_message(message);
      this.options.accept_message(message);
    });
  }

  /** 收口 Assistant Message，并把草稿提交到 Active。 */
  async complete(
    message_id: string,
    status: "completed" | "stopped" | "failed",
    error?: string,
  ): Promise<void> {
    await this.enqueue_write(message_id, async () => {
      const current = this.require_streaming_assistant(message_id);
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
      await this.options.store.finalize_assistant_message(message);
      this.options.accept_message(message);
    });
  }

  /** 读取当前流式 Assistant 中的指定 Tool Part。 */
  find_streaming_tool(
    tool_call_id: string,
  ): SessionStreamingToolLocation | undefined {
    for (const message of this.options.list_messages()) {
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
    return await this.interaction_writer.request(request);
  }

  /** 原子保存用户响应，并按 Interaction 结果恢复或终止关联 Tool。 */
  async resolve_interaction(
    interaction_id: string,
    response: SessionInteractionResponse,
  ): Promise<SessionAssistantInteractionPart> {
    return await this.interaction_writer.resolve(interaction_id, response);
  }

  /** 原子结束未响应 Interaction，并把关联 Tool 标记为失败。 */
  async close_interaction(
    interaction_id: string,
    input: SessionInteractionCloseInput,
  ): Promise<SessionAssistantInteractionPart> {
    return await this.interaction_writer.close(interaction_id, input);
  }

  /** 串行执行同一 Assistant Message 的完整写事务。 */
  private async enqueue_write<T>(
    message_id: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.write_chains.get(message_id) || Promise.resolve();
    const result = previous.then(operation, operation);
    const chain = result.then(() => undefined, () => undefined);
    this.write_chains.set(message_id, chain);
    try {
      return await result;
    } finally {
      if (this.write_chains.get(message_id) === chain) {
        this.write_chains.delete(message_id);
      }
    }
  }

  /** 原子提交包含多个 Part 状态变化的 Assistant 完整快照。 */
  private async commit_snapshot(
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
    await this.options.store.write_assistant_message(message);
    const current_by_id = new Map(
      current.parts.map((part) => [part.part_id, part]),
    );
    const changed_parts = message.parts.filter((part) => {
      const previous = current_by_id.get(part.part_id);
      return !previous || JSON.stringify(previous) !== JSON.stringify(part);
    });
    if (changed_parts.length === 0) {
      this.options.accept_message(message);
      return;
    }
    for (const part of changed_parts) {
      this.options.accept_mutation({
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

  /** 读取指定的流式 Assistant Message，否则抛出稳定领域错误。 */
  private require_streaming_assistant(
    message_id: string,
  ): SessionAssistantMessage {
    const message = [...this.options.list_messages()].find(
      (item) => item.message_id === message_id,
    );
    if (!message || message.type !== "assistant") {
      throw new Error(`Session assistant Message not found: ${message_id}`);
    }
    if (message.status !== "streaming") {
      throw new Error(`Assistant Message is already closed: ${message_id}`);
    }
    return message;
  }
}
