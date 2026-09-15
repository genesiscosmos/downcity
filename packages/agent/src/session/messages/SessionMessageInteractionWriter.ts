/**
 * Session Message Interaction 写入器。
 *
 * Interaction 不是独立 Part，而是所属 Tool Part 的从属数据：Tool 在等待响应时阻塞，
 * 因此一次 Interaction 的完整生命周期严格落在所属 Tool 的执行区间内，归属即结构。
 *
 * 本模块只负责 Tool Part 内 Interaction 与 Tool 状态的原子转换；消息持久化、
 * revision 串行化与 Mutation 发布仍由 SessionMessages 提供，避免复制 canonical 状态。
 */

import type {
  SessionAgentInteraction,
  SessionAgentMessage,
  SessionAgentMessagePart,
  SessionAgentToolPart,
  SessionMessage,
} from "@downcity/type";
import type {
  SessionInteractionCloseInput,
  SessionInteractionRequest,
  SessionInteractionResponse,
} from "@downcity/type";
import type { SessionOpenMessageToolLocation } from "@/types/session/SessionTool.js";

/** Interaction 写入器依赖的最小 Message 能力。 */
interface SessionMessageInteractionWriterOptions {
  /** 返回当前 Session 内存中的 canonical Message 集合。 */
  list_messages: () => Iterable<SessionMessage>;
  /** 查找当前可写 Agent Message 中的指定 Tool Part。 */
  find_tool_in_open_message: (
    tool_call_id: string,
  ) => SessionOpenMessageToolLocation | undefined;
  /** 在指定 Assistant Message 的串行事务链中执行写操作。 */
  enqueue_assistant_write: <T>(
    message_id: string,
    operation: () => Promise<T>,
  ) => Promise<T>;
  /** 原子持久化 Assistant 完整快照并发布发生变化的 Part。 */
  commit_assistant_snapshot: (
    current: SessionAgentMessage,
    parts: SessionAgentMessagePart[],
  ) => Promise<void>;
}

/** 一次 Interaction 的定位结果：所属 Message、Tool 与自身。 */
interface SessionInteractionLocation {
  /** 所属 Assistant Message 标识。 */
  message_id: string;
  /** 承载该 Interaction 的 canonical Tool Part。 */
  tool: SessionAgentToolPart;
  /** Interaction 自身。 */
  interaction: SessionAgentInteraction;
}

/** 管理 canonical Assistant Message 内 Tool Part 的 Interaction 生命周期。 */
export class SessionMessageInteractionWriter {
  private readonly options: SessionMessageInteractionWriterOptions;

  constructor(options: SessionMessageInteractionWriterOptions) {
    this.options = options;
  }

  /** 返回当前 Session 中全部等待用户响应的 Interaction。 */
  list_pending(): SessionAgentInteraction[] {
    return [...this.options.list_messages()].flatMap((message) =>
      message.role === "agent"
        ? message.parts.flatMap((part) =>
            part.type === "tool"
              ? (part.interactions ?? []).flatMap((interaction) =>
                  interaction.status === "pending"
                    ? [structuredClone(interaction)]
                    : [],
                )
              : [],
          )
        : [],
    );
  }

  /** 原子创建 Interaction，并把所属 Tool 转为 waiting-user。 */
  async request(
    request: SessionInteractionRequest,
  ): Promise<SessionAgentInteraction> {
    const tool_call_id = request.source.tool_call_id;
    const tool = this.require_open_message_tool(tool_call_id);
    await this.options.enqueue_assistant_write(
      tool.message_id,
      async () => {
        const current = this.require_open_message(tool.message_id);
        const owner = current.parts.find(
          (part): part is SessionAgentToolPart =>
            part.type === "tool" && part.tool_call_id === tool_call_id,
        );
        if (!owner) {
          throw new Error(`Streaming Tool Part not found: ${tool_call_id}`);
        }
        if (
          (owner.interactions ?? []).some(
            (item) => item.interaction_id === request.interaction_id,
          )
        ) {
          throw new Error(
            `Session Interaction already exists: ${request.interaction_id}`,
          );
        }
        if (owner.state !== "ready" && owner.state !== "waiting-user") {
          throw new Error(
            `Tool Interaction requires ready input: ${tool_call_id} (${owner.state})`,
          );
        }

        const interaction: SessionAgentInteraction = {
          interaction_id: request.interaction_id,
          interaction_type: request.type,
          status: "pending",
          request: structuredClone(request),
        };
        await this.options.commit_assistant_snapshot(
          current,
          replace_tool(current.parts, {
            ...owner,
            state: "waiting-user",
            interactions: [...(owner.interactions ?? []), interaction],
          }),
        );
      },
    );
    return this.require_pending_interaction(request.interaction_id).interaction;
  }

  /** 原子保存用户响应，并按 Interaction 结果恢复或终止所属 Tool。 */
  async resolve(
    interaction_id: string,
    response: SessionInteractionResponse,
  ): Promise<SessionAgentInteraction> {
    const location = this.require_pending_interaction(interaction_id);
    if (location.interaction.interaction_type !== response.type) {
      throw new Error(`Session Interaction response type mismatch: ${interaction_id}`);
    }
    await this.options.enqueue_assistant_write(
      location.message_id,
      async () => {
        const current = this.require_open_message(location.message_id);
        const owner = require_tool_in(current, location.tool.part_id);
        if (owner.state !== "waiting-user") {
          throw new Error(
            `Tool is not waiting for Interaction: ${owner.tool_call_id} (${owner.state})`,
          );
        }
        const denied = response.outcome === "denied";
        await this.options.commit_assistant_snapshot(
          current,
          replace_tool(current.parts, {
            ...owner,
            state: denied ? "failed" : "running",
            ...(denied ? { error: "Interaction denied" } : {}),
            interactions: update_interaction(owner, interaction_id, (item) => ({
              ...item,
              status: denied ? "denied" : "resolved",
              response: structuredClone(response),
              resolved_at: Date.now(),
            })),
          }),
        );
      },
    );
    return this.require_interaction(interaction_id).interaction;
  }

  /** 原子结束未响应 Interaction，并把所属 Tool 标记为失败。 */
  async close(
    interaction_id: string,
    input: SessionInteractionCloseInput,
  ): Promise<SessionAgentInteraction> {
    const location = this.require_pending_interaction(interaction_id);
    await this.options.enqueue_assistant_write(
      location.message_id,
      async () => {
        const current = this.require_open_message(location.message_id);
        const owner = require_tool_in(current, location.tool.part_id);
        await this.options.commit_assistant_snapshot(
          current,
          replace_tool(current.parts, {
            ...owner,
            ...(owner.state === "waiting-user"
              ? { state: "failed" as const, error: "Interaction cancelled" }
              : {}),
            interactions: update_interaction(owner, interaction_id, (item) => ({
              ...item,
              status: "cancelled",
              resolved_at: Date.now(),
              cancel_reason: input.reason,
            })),
          }),
        );
      },
    );
    return this.require_interaction(interaction_id).interaction;
  }

  /** 读取指定或当前唯一的可写 Assistant Message。 */
  private require_open_message(
    message_id?: string,
  ): SessionAgentMessage {
    const message = message_id
      ? [...this.options.list_messages()].find(
          (item) => item.message_id === message_id,
        )
      : [...this.options.list_messages()].find(
          (item) => item.role === "agent",
        );
    if (!message || message.role !== "agent") {
      throw new Error(
        message_id
          ? `Writable Assistant Message not found: ${message_id}`
          : "Writable Assistant Message not found",
      );
    }
    return message;
  }

  /** 查找指定 Interaction 及其所属 Tool 与可写 Assistant。 */
  private find_interaction(
    interaction_id: string,
  ): SessionInteractionLocation | undefined {
    for (const message of this.options.list_messages()) {
      if (message.role !== "agent") continue;
      for (const part of message.parts) {
        if (part.type !== "tool") continue;
        const interaction = (part.interactions ?? []).find(
          (item) => item.interaction_id === interaction_id,
        );
        if (interaction) {
          return { message_id: message.message_id, tool: part, interaction };
        }
      }
    }
    return undefined;
  }

  /** 读取指定 Interaction，否则抛出稳定领域错误。 */
  private require_interaction(interaction_id: string): SessionInteractionLocation {
    const interaction = this.find_interaction(interaction_id);
    if (interaction) return interaction;
    throw new Error(`Session Interaction not found: ${interaction_id}`);
  }

  /** 读取指定 pending Interaction，否则拒绝重复响应终态 Interaction。 */
  private require_pending_interaction(
    interaction_id: string,
  ): SessionInteractionLocation {
    const interaction = this.require_interaction(interaction_id);
    if (interaction.interaction.status !== "pending") {
      throw new Error(
        `Session Interaction is already ${interaction.interaction.status}: ${interaction_id}`,
      );
    }
    return interaction;
  }

  /** 查找当前可写 Agent Message 中的 Tool Part，否则抛出明确错误。 */
  private require_open_message_tool(tool_call_id: string): SessionOpenMessageToolLocation {
    const tool = this.options.find_tool_in_open_message(tool_call_id);
    if (tool) return tool;
    throw new Error(`Streaming Tool Part not found: ${tool_call_id}`);
  }
}

/** 以新的 Tool Part 替换同 part_id 的旧值，其余 Part 保持原引用。 */
function replace_tool(
  parts: readonly SessionAgentMessagePart[],
  tool: SessionAgentToolPart,
): SessionAgentMessagePart[] {
  return parts.map((part) => (part.part_id === tool.part_id ? tool : part));
}

/** 读取指定 Message 中的 Tool Part，否则抛出稳定领域错误。 */
function require_tool_in(
  message: SessionAgentMessage,
  part_id: string,
): SessionAgentToolPart {
  const tool = message.parts.find(
    (part): part is SessionAgentToolPart =>
      part.type === "tool" && part.part_id === part_id,
  );
  if (!tool) throw new Error(`Streaming Tool Part not found: ${part_id}`);
  return tool;
}

/** 就地替换 Tool 内指定 Interaction，丢弃不存在的历史来源。 */
function update_interaction(
  tool: SessionAgentToolPart,
  interaction_id: string,
  update: (interaction: SessionAgentInteraction) => SessionAgentInteraction,
): SessionAgentInteraction[] {
  return (tool.interactions ?? []).map((item) =>
    item.interaction_id === interaction_id ? update(item) : item,
  );
}
