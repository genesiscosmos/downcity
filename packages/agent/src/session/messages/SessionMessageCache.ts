/**
 * Session Message 内存缓存与实时 Mutation 发布边界。
 *
 * 缓存只保留「被未收口 writer 持有」的 Agent Message；终态历史始终读取 Store。
 * 本模块同时拥有对外发布形状的唯一判断——调用方只提交完整快照，由这里决定发整条
 * Message 还是只发发生变化的 Part。
 *
 * 抽出它的原因是打破 SessionMessages 与 Agent Message 运行时之间的双向依赖：
 * 两者都只单向依赖本模块，不再需要互相回指的闭包。
 */

import { generate_id } from "@/utils/Id.js";
import { resolve_changed_agent_parts } from "@/session/messages/SessionAgentParts.js";
import { create_session_part_mutation } from "@/session/messages/SessionMutationFactory.js";
import type {
  SessionAgentMessage,
  SessionAgentMessagePart,
  SessionMessage,
  SessionMutation,
} from "@downcity/type";

/** SessionMessageCache 构造参数。 */
export interface SessionMessageCacheOptions {
  /** 当前缓存所属 Session 标识。 */
  session_id: string;
  /** 订阅方接收实时 Mutation 的发布函数。 */
  publish: (mutation: SessionMutation) => void;
}

/** 一个 Session 的内存 Message 缓存与 Mutation 发布边界。 */
export class SessionMessageCache {
  private readonly session_id: string;
  private readonly publish: SessionMessageCacheOptions["publish"];
  private readonly messages_by_id = new Map<string, SessionMessage>();
  /** 当前被未收口 writer 持有的 Message；同一时刻至多一条。 */
  private held_id: string | null = null;

  constructor(options: SessionMessageCacheOptions) {
    this.session_id = options.session_id;
    this.publish = options.publish;
  }

  /** 读取一条已缓存的 Message。 */
  get(message_id: string): SessionMessage | undefined {
    return this.messages_by_id.get(message_id);
  }

  /** 返回当前缓存中的全部 Message。 */
  all(): Iterable<SessionMessage> {
    return this.messages_by_id.values();
  }

  /** 登记当前正在写入的 Message。 */
  set_held(message_id: string): void {
    this.held_id = message_id;
  }

  /** 释放指定 Message 的持有关系；不匹配时忽略。 */
  release_held(message_id: string): void {
    if (this.held_id === message_id) this.held_id = null;
  }

  /** 指定 Message 是否仍被未收口的 writer 持有。 */
  is_held(message_id: string): boolean {
    return this.held_id === message_id;
  }

  /** 返回当前被未收口 writer 持有的 Message 标识。 */
  held_message_id(): string | undefined {
    return this.held_id ?? undefined;
  }

  /**
   * 接受已持久化的完整快照。
   *
   * 发布形状由快照差异决定，调用方不需要描述「变化了什么」；
   * publish_mutation 为 false 时只更新运行缓存。
   */
  accept(message: SessionMessage, publish_mutation = true): void {
    const previous = this.get(message.message_id);
    this.remember(message);
    if (!publish_mutation) return;
    const change = project_message_change(previous, message);
    if (change.variant === "message") {
      this.publish(this.build_message_mutation(message));
      return;
    }
    for (const part of change.parts) {
      this.publish(this.build_part_mutation(change.message, part));
    }
  }

  /** 接受一条尚未持久化的实时 Mutation 及其对应的运行快照。 */
  project(mutation: SessionMutation, message: SessionMessage): void {
    this.remember(message);
    this.publish(mutation);
  }

  /** 只缓存被 writer 持有的 Agent Message；终态历史始终读取 Store。 */
  private remember(message: SessionMessage): void {
    this.messages_by_id.delete(message.message_id);
    if (message.role !== "agent") return;
    if (!this.is_held(message.message_id)) return;
    this.messages_by_id.set(message.message_id, structuredClone(message));
  }

  /** 构造一条完整 Message Mutation。 */
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

  /** 构造一条单 Part Mutation。 */
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
      (part) => !message.parts.some((next) => next.part_id === part.part_id),
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
