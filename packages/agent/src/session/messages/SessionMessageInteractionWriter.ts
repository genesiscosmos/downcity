/**
 * Session Message Interaction 写入器。
 *
 * 该模块只负责 Assistant Message 内 Interaction Part 与关联 Tool Part 的
 * 原子状态转换；消息持久化、revision 串行化和 Mutation 发布仍由
 * SessionMessages 提供，避免复制 canonical Message 状态。
 */

import type {
  SessionAssistantInteractionPart,
  SessionAssistantMessage,
  SessionAssistantMessagePart,
  SessionMessage,
} from "@/types/session/SessionMessage.js";
import type {
  SessionInteractionRequest,
  SessionInteractionResponse,
} from "@/types/session/SessionInteraction.js";
import type { SessionStreamingToolLocation } from "@/types/session/SessionTool.js";

/** Interaction 写入器依赖的最小 Message 能力。 */
interface SessionMessageInteractionWriterOptions {
  /** 返回当前 Session 内存中的 canonical Message 集合。 */
  list_messages: () => Iterable<SessionMessage>;
  /** 查找当前流式 Assistant 中的指定 Tool Part。 */
  find_streaming_tool: (
    tool_call_id: string,
  ) => SessionStreamingToolLocation | undefined;
  /** 在指定 Assistant Message 的串行事务链中执行写操作。 */
  enqueue_assistant_write: <T>(
    message_id: string,
    operation: () => Promise<T>,
  ) => Promise<T>;
  /** 原子持久化 Assistant 完整快照并发布发生变化的 Part。 */
  commit_assistant_snapshot: (
    current: SessionAssistantMessage,
    parts: SessionAssistantMessagePart[],
  ) => Promise<void>;
}

/** 管理 canonical Assistant Message 内的 Interaction 生命周期。 */
export class SessionMessageInteractionWriter {
  private readonly options: SessionMessageInteractionWriterOptions;

  constructor(options: SessionMessageInteractionWriterOptions) {
    this.options = options;
  }

  /** 返回当前 Session 中全部等待用户响应的 canonical Interaction。 */
  list_pending(): SessionAssistantInteractionPart[] {
    return [...this.options.list_messages()].flatMap((message) =>
      message.type === "assistant" && message.status === "streaming"
        ? message.parts.flatMap((part) =>
            part.type === "interaction" && part.status === "pending"
              ? [structuredClone(part)]
              : [],
          )
        : [],
    );
  }

  /** 原子创建 Interaction，并把关联 Tool 转为 waiting-user。 */
  async request(
    request: SessionInteractionRequest,
  ): Promise<SessionAssistantInteractionPart> {
    const message_id = request.source.type === "tool"
      ? this.require_streaming_tool(request.source.tool_call_id).message_id
      : this.require_streaming_assistant().message_id;
    await this.options.enqueue_assistant_write(message_id, async () => {
      const current = this.require_streaming_assistant(message_id);
      if (
        current.parts.some(
          (part) =>
            part.type === "interaction" &&
            part.interaction_id === request.interaction_id,
        )
      ) {
        throw new Error(`Session Interaction already exists: ${request.interaction_id}`);
      }

      let parts = current.parts;
      if (request.source.type === "tool") {
        const tool = this.require_streaming_tool(request.source.tool_call_id);
        if (tool.message_id !== message_id) {
          throw new Error(
            `Tool Assistant Message changed: ${request.source.tool_call_id}`,
          );
        }
        if (tool.part.state !== "ready") {
          throw new Error(
            `Tool Interaction requires ready input: ${request.source.tool_call_id} (${tool.part.state})`,
          );
        }
        parts = parts.map((part) =>
          part.part_id === tool.part.part_id
            ? { ...tool.part, state: "waiting-user" as const }
            : part,
        );
      }

      const interaction: SessionAssistantInteractionPart = {
        part_id: `interaction:${request.interaction_id}`,
        sequence: parts.reduce(
          (sequence, part) => Math.max(sequence, part.sequence + 1),
          1,
        ),
        type: "interaction",
        interaction_id: request.interaction_id,
        interaction_type: request.kind,
        status: "pending",
        request: structuredClone(request),
      };
      await this.options.commit_assistant_snapshot(current, [...parts, interaction]);
    });
    return this.require_pending_interaction(request.interaction_id).part;
  }

  /** 原子保存用户响应，并按 Interaction 结果恢复或终止关联 Tool。 */
  async resolve(
    interaction_id: string,
    response: SessionInteractionResponse,
  ): Promise<SessionAssistantInteractionPart> {
    const { message_id } = this.require_pending_interaction(interaction_id);
    await this.options.enqueue_assistant_write(message_id, async () => {
      const current = this.require_streaming_assistant(message_id);
      const interaction = this.require_pending_interaction(interaction_id);
      if (interaction.message_id !== message_id) {
        throw new Error(`Session Interaction Message changed: ${interaction_id}`);
      }
      if (interaction.part.interaction_type !== response.kind) {
        throw new Error(`Session Interaction response kind mismatch: ${interaction_id}`);
      }
      const denied = response.kind === "approval" && response.decision === "denied";
      const parts = current.parts.map((part) => {
        if (part.part_id === interaction.part.part_id) {
          return {
            ...interaction.part,
            status: "resolved" as const,
            response: structuredClone(response),
            resolved_at: Date.now(),
          };
        }
        if (
          interaction.part.request.source.type === "tool" &&
          part.type === "tool" &&
          part.tool_call_id === interaction.part.request.source.tool_call_id
        ) {
          if (part.state !== "waiting-user") {
            throw new Error(
              `Tool is not waiting for Interaction: ${part.tool_call_id} (${part.state})`,
            );
          }
          return denied
            ? { ...part, state: "failed" as const, error: "Interaction denied" }
            : { ...part, state: "running" as const };
        }
        return part;
      });
      await this.options.commit_assistant_snapshot(current, parts);
    });
    return this.require_interaction(interaction_id).part;
  }

  /** 原子结束未响应 Interaction，并把关联 Tool 标记为失败。 */
  async close(
    interaction_id: string,
    input:
      | { status: "expired" }
      | {
          status: "cancelled";
          reason: "turn_stopped" | "session_disposed" | "runtime_interrupted";
        },
  ): Promise<SessionAssistantInteractionPart> {
    const { message_id } = this.require_pending_interaction(interaction_id);
    await this.options.enqueue_assistant_write(message_id, async () => {
      const current = this.require_streaming_assistant(message_id);
      const interaction = this.require_pending_interaction(interaction_id);
      const error = input.status === "expired"
        ? "Interaction expired"
        : "Interaction cancelled";
      const parts = current.parts.map((part) => {
        if (part.part_id === interaction.part.part_id) {
          return {
            ...interaction.part,
            status: input.status,
            resolved_at: Date.now(),
            ...(input.status === "cancelled"
              ? { cancel_reason: input.reason }
              : {}),
          };
        }
        if (
          interaction.part.request.source.type === "tool" &&
          part.type === "tool" &&
          part.tool_call_id === interaction.part.request.source.tool_call_id
        ) {
          if (part.state !== "waiting-user") return part;
          return { ...part, state: "failed" as const, error };
        }
        return part;
      });
      await this.options.commit_assistant_snapshot(current, parts);
    });
    return this.require_interaction(interaction_id).part;
  }

  /** 读取指定或当前唯一的流式 Assistant Message。 */
  private require_streaming_assistant(
    message_id?: string,
  ): SessionAssistantMessage {
    const message = message_id
      ? [...this.options.list_messages()].find(
          (item) => item.message_id === message_id,
        )
      : [...this.options.list_messages()].find(
          (item) => item.type === "assistant" && item.status === "streaming",
        );
    if (!message || message.type !== "assistant" || message.status !== "streaming") {
      throw new Error(
        message_id
          ? `Streaming Assistant Message not found: ${message_id}`
          : "Streaming Assistant Message not found",
      );
    }
    return message;
  }

  /** 查找指定 Interaction Part 及其所属流式 Assistant。 */
  private find_interaction(interaction_id: string):
    | {
        message_id: string;
        part: SessionAssistantInteractionPart;
      }
    | undefined {
    for (const message of this.options.list_messages()) {
      if (message.type !== "assistant" || message.status !== "streaming") continue;
      const part = message.parts.find(
        (item): item is SessionAssistantInteractionPart =>
          item.type === "interaction" &&
          item.interaction_id === interaction_id,
      );
      if (part) return { message_id: message.message_id, part };
    }
    return undefined;
  }

  /** 读取指定 Interaction，否则抛出稳定领域错误。 */
  private require_interaction(interaction_id: string): {
    message_id: string;
    part: SessionAssistantInteractionPart;
  } {
    const interaction = this.find_interaction(interaction_id);
    if (interaction) return interaction;
    throw new Error(`Session Interaction not found: ${interaction_id}`);
  }

  /** 读取指定 pending Interaction，否则拒绝重复响应终态 Interaction。 */
  private require_pending_interaction(interaction_id: string): {
    message_id: string;
    part: SessionAssistantInteractionPart;
  } {
    const interaction = this.require_interaction(interaction_id);
    if (interaction.part.status !== "pending") {
      throw new Error(
        `Session Interaction is already ${interaction.part.status}: ${interaction_id}`,
      );
    }
    return interaction;
  }

  /** 查找当前流式 Assistant 中的 Tool Part，否则抛出明确错误。 */
  private require_streaming_tool(tool_call_id: string): SessionStreamingToolLocation {
    const tool = this.options.find_streaming_tool(tool_call_id);
    if (tool) return tool;
    throw new Error(`Streaming Tool Part not found: ${tool_call_id}`);
  }
}
