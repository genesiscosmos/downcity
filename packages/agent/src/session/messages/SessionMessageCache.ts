/**
 * Session Message 内存缓存与实时 Mutation 发布边界。
 *
 * 缓存只保留「被未收口 writer 持有」的 Agent Message；终态历史始终读取 Store。
 * 本模块同时拥有对外发布形状的唯一判断——调用方只提交完整快照，由这里决定发整条
 * Message 还是只发一个变化的 Part；一次提交只发布一个消息版本，避免多 Part 共用版本。
 *
 * 抽出它的原因是打破 SessionMessages 与 Agent Message 运行时之间的双向依赖：
 * 两者都只单向依赖本模块，不再需要互相回指的闭包。
 *
 * 引用所有权：持久化快照在 accept 边界复制一次；project 接管状态转换器新建的
 * 不可变运行投影，与上一投影共享未变化的 Parts。get/all 仅供领域内部只读使用；
 * 对外读取由 SessionMessages 复制，实时 Part Mutation 由状态转换器独立复制，
 * 避免每个 delta 重复遍历、复制此前所有工具结果和模型输入依据。
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
  /** 已持久化的用户消息或 Agent 首次终态所产生的活动时间。 */
  on_activity?: (activity_at: number) => void;
  /** 订阅方接收实时 Mutation 的发布函数。 */
  publish: (mutation: SessionMutation) => void;
}

/** 一个 Session 的内存 Message 缓存与 Mutation 发布边界。 */
export class SessionMessageCache {
  private readonly session_id: string;
  private readonly publish: SessionMessageCacheOptions["publish"];
  private readonly on_activity: SessionMessageCacheOptions["on_activity"];
  private readonly messages_by_id = new Map<string, SessionMessage>();
  /** 当前被未收口 writer 持有的 Message；同一时刻至多一条。 */
  private held_id: string | null = null;

  constructor(options: SessionMessageCacheOptions) {
    this.session_id = options.session_id;
    this.publish = options.publish;
    this.on_activity = options.on_activity;
  }

  /** 领域内部只读借用当前投影；不得修改，也不得直接返回给外部调用方。 */
  get(message_id: string): SessionMessage | undefined {
    return this.messages_by_id.get(message_id);
  }

  /** 领域内部只读遍历；更新必须构造新 Message/Part，不能修改借用的引用。 */
  all(): Iterable<SessionMessage> {
    return this.messages_by_id.values();
  }

  /** 登记当前正在写入的 Message。 */
  set_held(message_id: string): void {
    this.held_id = message_id;
  }

  /**
   * 释放指定 Message 的持有关系并移除其运行缓存；不匹配时忽略。
   *
   * 收口快照会先在 held 状态下进入缓存，再由这里完成驱逐。这样发布失败时
   * 仍保留完整快照和持有关系，Writer 可以重试而不会丢失可写状态。
   */
  release_held(message_id: string): void {
    if (this.held_id !== message_id) return;
    this.held_id = null;
    this.messages_by_id.delete(message_id);
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
   * publish_mutation 为 false 时只更新运行缓存；persisted_previous 供非 writer 消息精确判断终态转换。
   */
  accept(message: SessionMessage, publish_mutation = true, persisted_previous?: SessionMessage): void {
    const previous = this.get(message.message_id);
    const before_commit = persisted_previous ?? previous;
    if (message.role === "user") this.on_activity?.(message.created_at);
    else if (message.state !== "streaming" && (message.revision === 1 || before_commit?.role === "agent" && before_commit.state === "streaming")) {
      this.on_activity?.(message.updated_at);
    }
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

  /** 发布已提交的历史截断边界，让订阅方移除过期消息。 */
  publish_history_truncation(through_sequence: number): void {
    this.publish({
      mutation_id: generate_id(),
      variant: "session",
      type: "truncate",
      session_id: this.session_id,
      created_at: Date.now(),
      through_sequence,
    });
  }

  /**
   * 接管状态转换器拥有的新运行投影，未变化 Parts 继续共享，不复制整条 Message。
   * 调用方在转移后只能只读使用；Mutation 必须与缓存隔离，delta 仅含值类型，
   * Part Mutation 由 project_part 单独复制，不能携带投影中的可变对象引用。
   */
  project(mutation: SessionMutation, message: SessionMessage): void {
    if (message.role === "agent" && this.is_held(message.message_id)) {
      this.messages_by_id.set(message.message_id, message);
    } else {
      this.messages_by_id.delete(message.message_id);
    }
    this.publish(mutation);
  }

  /** 持久化快照可能同时交给外部调用方或订阅者，只在此边界复制一次以隔离引用。 */
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
 * 整条发布。单个 Part 变化只发 Part；多个 Part 变化发布完整消息，保证一个 revision
 * 对应一次可完整应用的消息变化。没有内容或 envelope 变化时无需发布。
 */
function project_message_change(
  previous: SessionMessage | undefined,
  message: SessionMessage,
): SessionMessageChange {
  if (
    previous?.role !== "agent" ||
    message.role !== "agent" ||
    previous.state !== message.state ||
    previous.stable_part_sequence !== message.stable_part_sequence ||
    JSON.stringify(previous.current_error) !== JSON.stringify(message.current_error) ||
    previous.parts.some(
      (part) => !message.parts.some((next) => next.part_id === part.part_id),
    )
  ) {
    return { variant: "message" };
  }
  const parts = resolve_changed_agent_parts(previous.parts, message.parts);
  return parts.length > 1 ? { variant: "message" } : { variant: "part", message, parts };
}
