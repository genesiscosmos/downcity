/**
 * canonical Agent Message 的运行投影与检查点提交器。
 *
 * Model stream 只更新内存投影并发布实时 Mutation；完整 Step、Tool、Interaction
 * 与 Message 收口才通过一次 SQLite 事务提交稳定快照。数据库不承担流事件日志职责。
 */

import { generate_id } from "@/utils/Id.js";
import { create_session_part_mutation } from "@/session/messages/SessionMutationFactory.js";
import { resolve_session_message_state } from "@/session/messages/SessionMessageState.js";
import {
  is_same_agent_part,
  next_agent_part_sequence,
  resolve_changed_agent_parts,
} from "@/session/messages/SessionAgentParts.js";
import type {
  SessionAgentErrorPart,
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
import type { SessionAgentMessageStateOptions } from "@/types/session/SessionAgentMessageState.js";

/** 一次 Interaction 的定位结果：所属 Message、Tool 与自身。 */
interface SessionInteractionLocation {
  /** 所属 Agent Message 标识。 */
  message_id: string;
  /** 承载该 Interaction 的 canonical Tool Part。 */
  tool: SessionAgentToolPart;
  /** Interaction 自身。 */
  interaction: SessionAgentInteraction;
}

/** 管理 Agent Message 运行投影、语义检查点与 Interaction 原子状态。 */
export class SessionAgentMessageState {
  private readonly session_id: string;
  private readonly options: SessionAgentMessageStateOptions;
  /** 同一 Agent Message 的检查点严格串行，不同 Message 可以独立提交。 */
  private readonly write_chains = new Map<string, Promise<void>>();

  constructor(options: SessionAgentMessageStateOptions) {
    this.session_id = options.session_id;
    this.options = options;
  }

  /**
   * 只在内存中创建或替换一个 Part，并立即发布实时完整 Part。
   *
   * 内容未变化时不发布：Tool 的 ready 状态会被模型事件与输入校验先后置为同一值，
   * 无条件下发会产生同 revision、同内容的重复 Mutation。
   */
  project_part(message_id: string, part: SessionAgentMessagePart): void {
    const current = this.require_writable_agent(message_id);
    const existing = current.parts.find((item) => item.part_id === part.part_id);
    if (existing && existing.sequence !== part.sequence) {
      throw new Error(`Agent Part sequence changed: ${part.part_id}`);
    }
    if (existing && is_same_agent_part(existing, part)) return;
    const projected: SessionAgentMessage = {
      ...current,
      updated_at: Date.now(),
      parts: (existing
        ? current.parts.map((item) => item.part_id === part.part_id ? structuredClone(part) : item)
        : [...current.parts, structuredClone(part)]
      ).sort((left, right) => left.sequence - right.sequence),
    };
    this.options.cache.project(
      create_session_part_mutation({
        mutation_id: generate_id(),
        session_id: this.session_id,
        message_id,
        ...(current.turn_id ? { turn_id: current.turn_id } : {}),
        revision: current.revision,
        created_at: projected.updated_at,
        part: structuredClone(part),
      }),
      projected,
    );
  }

  /** 只在内存中追加文本、推理或 Tool 输入增量，并立即发布 delta。 */
  project_delta(
    message_id: string,
    part_id: string,
    type: "text" | "reasoning" | "tool_input",
    delta: string,
    tool_call_id?: string,
  ): void {
    if (!delta) return;
    const current = this.require_writable_agent(message_id);
    let matched = false;
    const projected: SessionAgentMessage = {
      ...current,
      updated_at: Date.now(),
      parts: current.parts.map((part) => {
        if (part.part_id !== part_id) return part;
        if (
          (type === "text" || type === "reasoning") &&
          (part.type === "text" || part.type === "reasoning") &&
          part.type === type
        ) {
          matched = true;
          return { ...part, text: part.text + delta };
        }
        if (
          type === "tool_input" && part.type === "tool" &&
          part.tool_call_id === tool_call_id && part.state === "input-streaming"
        ) {
          matched = true;
          return { ...part, input_text: `${part.input_text || ""}${delta}` };
        }
        throw new Error(`Delta target Part is incompatible: ${part_id}`);
      }),
    };
    if (!matched) throw new Error(`Delta target Part does not exist: ${part_id}`);
    const base = {
      mutation_id: generate_id(),
      variant: "delta" as const,
      message_id,
      ...(current.turn_id ? { turn_id: current.turn_id } : {}),
      revision: current.revision,
      session_id: this.session_id,
      created_at: projected.updated_at,
      part_id,
      delta,
    };
    const tool_input_id = type === "tool_input" ? String(tool_call_id || "").trim() : "";
    this.options.cache.project(
      type === "tool_input"
        ? { ...base, type, tool_call_id: tool_input_id }
        : { ...base, type },
      projected,
    );
  }

  /** 将当前内存投影作为一个稳定语义检查点原子提交。 */
  async checkpoint(message_id: string): Promise<void> {
    await this.enqueue_write(message_id, async () => {
      const current = this.require_writable_agent(message_id);
      await this.persist_snapshot(message_id, current.parts);
    });
  }

  /** 校验 Step Part identity 后原子提交模型给出的最终快照。 */
  async commit_step(
    message_id: string,
    parts: SessionAgentMessagePart[],
  ): Promise<void> {
    await this.enqueue_write(message_id, async () => {
      const current = this.require_writable_agent(message_id);
      if (
        parts.length !== current.parts.length ||
        parts.some((part, index) =>
          part.part_id !== current.parts[index]?.part_id ||
          part.sequence !== current.parts[index]?.sequence
        )
      ) {
        throw new Error(`Agent step changed canonical Part identity: ${message_id}`);
      }
      await this.persist_snapshot(message_id, parts);
    });
  }

  /**
   * 原子追加或替换一组非流式 Agent Parts。
   *
   * 同 part_id 已存在时原地替换并保留原 sequence；不存在时追加到 Message 末尾。
   * options.publish_mutation 为 false 时只更新 canonical 快照而不发布 Mutation。
   */
  async commit_parts(
    message_id: string,
    parts: readonly SessionAgentMessagePart[],
    options?: { publish_mutation?: boolean },
  ): Promise<void> {
    if (parts.length === 0) return;
    await this.enqueue_write(message_id, async () => {
      const current = this.require_writable_agent(message_id);
      const replacements = new Map(parts.map((part) => [part.part_id, structuredClone(part)]));
      const existing_ids = new Set(current.parts.map((part) => part.part_id));
      const merged = current.parts.map((part) => replacements.get(part.part_id) ?? part);
      for (const part of parts) {
        if (!existing_ids.has(part.part_id)) merged.push(structuredClone(part));
      }
      await this.persist_snapshot(
        message_id,
        merged.sort((left, right) => left.sequence - right.sequence),
        { publish_mutation: options?.publish_mutation !== false },
      );
    });
  }

  /** 丢弃当前未提交 Step 投影，并向订阅方恢复最近持久化快照。 */
  async rollback_projection(message_id: string): Promise<void> {
    await this.enqueue_write(message_id, async () => {
      const persisted = await this.options.store.read_message(message_id);
      if (!persisted || persisted.role !== "agent") {
        throw new Error(`Persisted Agent Message not found: ${message_id}`);
      }
      this.options.cache.accept(persisted);
    });
  }

  /** 收口 Agent Message，并将局部非终态与失败原因一并原子提交。 */
  async complete(
    message_id: string,
    outcome: "completed" | "stopped" | "failed",
    error?: string,
  ): Promise<void> {
    // 先释放持有，收口提交才能把 Message 收敛为终态。
    this.options.cache.release_held(message_id);
    await this.enqueue_write(message_id, async () => {
      const current = this.require_writable_agent(message_id);
      const completed_at = Date.now();
      const parts: SessionAgentMessagePart[] = current.parts.map((part) => {
        if (part.type === "text" || part.type === "reasoning") {
          return { ...part, state: "done" as const };
        }
        if (part.type === "action" && part.state === "running") {
          return {
            ...part,
            state: outcome === "completed" ? "completed" as const : "failed" as const,
            ...(outcome === "completed" || part.description
              ? {}
              : { description: error || "Action did not complete before Agent Message closed" }),
          };
        }
        if (part.type !== "tool") return part;
        // Interaction 属于 Tool，收口时随所属 Tool 一起终止。
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
                    resolved_at: completed_at,
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
          interactions,
          error: outcome === "stopped" && part.state === "waiting-user" &&
              had_pending_interaction
            ? "Interaction cancelled"
            : error || "Tool did not complete before Agent Message closed",
        };
      });
      if (outcome === "stopped" && !parts.some((part) =>
        part.type === "error" && part.code === "turn_stopped"
      )) {
        parts.push(create_terminal_error_part(parts, "turn_stopped", error || "Turn stopped"));
      } else if (outcome === "failed" && error && !parts.some((part) => part.type === "error")) {
        parts.push(create_terminal_error_part(parts, "turn_execution_failed", error));
      }
      await this.persist_snapshot(message_id, parts, { held_by_writer: false });
    });
  }

  /** 读取当前可写 Agent Message 中的指定 Tool Part。 */
  find_tool_in_open_message(tool_call_id: string): SessionOpenMessageToolLocation | undefined {
    for (const message of this.options.cache.all()) {
      if (message.role !== "agent") continue;
      const part = message.parts.find(
        (item): item is SessionAgentToolPart =>
          item.type === "tool" && item.tool_call_id === tool_call_id,
      );
      if (part) return { message_id: message.message_id, part };
    }
    return undefined;
  }

  /** 返回当前 Session 中全部等待用户响应的 Interaction。 */
  list_pending_interactions(): SessionAgentInteraction[] {
    return [...this.options.cache.all()].flatMap((message) =>
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

  /**
   * 原子创建 Interaction，并把所属 Tool 转为 waiting-user。
   *
   * Interaction 是 Tool Part 的从属数据：Tool 在等待响应时阻塞，因此两者的转换
   * 必须在同一次快照提交内完成，否则会出现“Interaction pending 但 Tool 未等待”的中间态。
   */
  async request_interaction(
    request: SessionInteractionRequest,
  ): Promise<SessionAgentInteraction> {
    const tool_call_id = request.source.tool_call_id;
    await this.run_interaction_write(tool_call_id, async (current, owner) => {
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
      await this.persist_snapshot(
        current.message_id,
        replace_tool_part(current.parts, {
          ...owner,
          state: "waiting-user",
          interactions: [...(owner.interactions ?? []), interaction],
        }),
      );
    });
    return this.require_pending_interaction(request.interaction_id).interaction;
  }

  /** 原子保存用户响应，并按 Interaction 结果恢复或终止所属 Tool。 */
  async resolve_interaction(
    interaction_id: string,
    response: SessionInteractionResponse,
  ): Promise<SessionAgentInteraction> {
    const location = this.require_pending_interaction(interaction_id);
    if (location.interaction.interaction_type !== response.type) {
      throw new Error(`Session Interaction response type mismatch: ${interaction_id}`);
    }
    await this.enqueue_write(location.message_id, async () => {
      const current = this.require_writable_agent(location.message_id);
      const owner = require_tool_part_in(current, location.tool.part_id);
      if (owner.state !== "waiting-user") {
        throw new Error(
          `Tool is not waiting for Interaction: ${owner.tool_call_id} (${owner.state})`,
        );
      }
      const denied = response.outcome === "denied";
      await this.persist_snapshot(
        current.message_id,
        replace_tool_part(current.parts, {
          ...owner,
          state: denied ? "failed" : "running",
          ...(denied ? { error: "Interaction denied" } : {}),
          interactions: update_tool_interaction(owner, interaction_id, (item) => ({
            ...item,
            status: denied ? "denied" : "resolved",
            response: structuredClone(response),
            resolved_at: Date.now(),
          })),
        }),
      );
    });
    return this.require_interaction(interaction_id).interaction;
  }

  /** 原子结束未响应 Interaction，并把所属 Tool 标记为失败。 */
  async close_interaction(
    interaction_id: string,
    input: SessionInteractionCloseInput,
  ): Promise<SessionAgentInteraction> {
    const location = this.require_pending_interaction(interaction_id);
    await this.enqueue_write(location.message_id, async () => {
      const current = this.require_writable_agent(location.message_id);
      const owner = require_tool_part_in(current, location.tool.part_id);
      await this.persist_snapshot(
        current.message_id,
        replace_tool_part(current.parts, {
          ...owner,
          ...(owner.state === "waiting-user"
            ? { state: "failed" as const, error: "Interaction cancelled" }
            : {}),
          interactions: update_tool_interaction(owner, interaction_id, (item) => ({
            ...item,
            status: "cancelled",
            resolved_at: Date.now(),
            cancel_reason: input.reason,
          })),
        }),
      );
    });
    return this.require_interaction(interaction_id).interaction;
  }

  /** 原子保存完整 Message 快照；变更比较以数据库事实而非运行投影为准。 */
  private async persist_snapshot(
    message_id: string,
    parts: SessionAgentMessagePart[],
    options?: {
      /** 本次提交后是否仍由 writer 持有；收口时传 false。省略时读取当前持有关系。 */
      held_by_writer?: boolean;
      /** 是否向订阅方发布 Message Mutation。 */
      publish_mutation?: boolean;
    },
  ): Promise<void> {
    const persisted = await this.options.store.read_message(message_id);
    if (!persisted || persisted.role !== "agent") {
      throw new Error(`Agent Message not found: ${message_id}`);
    }
    const committed_at = Date.now();
    const next_parts = structuredClone(parts).sort(
      (left, right) => left.sequence - right.sequence,
    );
    const message: SessionAgentMessage = {
      ...persisted,
      state: resolve_session_message_state(
        next_parts,
        options?.held_by_writer ?? this.options.cache.is_held(message_id),
      ),
      revision: persisted.revision + 1,
      updated_at: committed_at,
      parts: next_parts,
    };
    const changed_parts = resolve_changed_agent_parts(persisted.parts, message.parts);
    await this.options.store.update_message({
      message,
      expected_revision: persisted.revision,
      changed_parts,
    });
    this.options.cache.accept(message, options?.publish_mutation !== false);
  }

  /** 串行执行同一 Message 的语义检查点。 */
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
      if (this.write_chains.get(message_id) === chain) this.write_chains.delete(message_id);
    }
  }

  /**
   * 在所属 Tool 的串行写链内执行一次 Interaction 变更。
   *
   * Interaction 与 Tool 必须整体提交：先定位 Tool，再在同一串行段内读取最新快照并替换它，
   * 避免两个并发响应基于过期快照各自提交。
   */
  private async run_interaction_write(
    tool_call_id: string,
    operation: (
      current: SessionAgentMessage,
      owner: SessionAgentToolPart,
    ) => Promise<void>,
  ): Promise<void> {
    const located = this.find_tool_in_open_message(tool_call_id);
    if (!located) throw new Error(`Open Tool Part not found: ${tool_call_id}`);
    await this.enqueue_write(located.message_id, async () => {
      const current = this.require_writable_agent(located.message_id);
      const owner = require_tool_part_in(current, located.part.part_id);
      await operation(current, owner);
    });
  }

  /** 查找指定 Interaction 及其所属 Tool 与 Message。 */
  private find_interaction(
    interaction_id: string,
  ): SessionInteractionLocation | undefined {
    for (const message of this.options.cache.all()) {
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

  /** 读取当前运行投影中的可写 Agent Message；只有 writer 持有的消息可写。 */
  private require_writable_agent(message_id: string): SessionAgentMessage {
    const message = [...this.options.cache.all()].find(
      (item) => item.message_id === message_id,
    );
    if (!message || message.role !== "agent") {
      throw new Error(`Writable Agent Message not found: ${message_id}`);
    }
    return message;
  }
}

/** 以新的 Tool Part 替换同 part_id 的旧值，其余 Part 保持原引用。 */
function replace_tool_part(
  parts: readonly SessionAgentMessagePart[],
  tool: SessionAgentToolPart,
): SessionAgentMessagePart[] {
  return parts.map((part) => (part.part_id === tool.part_id ? tool : part));
}

/** 读取指定 Message 中的 Tool Part，否则抛出稳定领域错误。 */
function require_tool_part_in(
  message: SessionAgentMessage,
  part_id: string,
): SessionAgentToolPart {
  const tool = message.parts.find(
    (part): part is SessionAgentToolPart =>
      part.type === "tool" && part.part_id === part_id,
  );
  if (!tool) throw new Error(`Open Tool Part not found: ${part_id}`);
  return tool;
}

/** 就地替换 Tool 内指定 Interaction，丢弃不存在的历史来源。 */
function update_tool_interaction(
  tool: SessionAgentToolPart,
  interaction_id: string,
  update: (interaction: SessionAgentInteraction) => SessionAgentInteraction,
): SessionAgentInteraction[] {
  return (tool.interactions ?? []).map((item) =>
    item.interaction_id === interaction_id ? update(item) : item,
  );
}

/** 为 Message 终止原因创建最后一个 Error Part。 */
function create_terminal_error_part(
  parts: readonly SessionAgentMessagePart[],
  code: string,
  message: string,
): SessionAgentErrorPart {
  return {
    part_id: `error:${generate_id()}`,
    sequence: next_agent_part_sequence(parts),
    type: "error",
    scope: "turn",
    code,
    message,
    recoverable: true,
  };
}

