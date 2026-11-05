/**
 * Agent 主体的 Session Interaction 集合。
 *
 * 只拥有订阅，不拥有交互状态或执行队列。查询直接读取 SessionStore 的非终态投影；
 * 实时消息从 Session canonical mutations 投影，回应回到已加载的原 Session 串行入口。
 */
import type { SessionMutation } from "@downcity/type";
import type {
  AgentInteractionChange,
  AgentInteractionCollection,
  AgentListInteractionsInput,
  AgentRespondInteractionInput,
  AgentInteractionsOptions,
} from "@/types/agent/AgentInteractions.js";
import type { AgentSession } from "@/types/agent/SessionActor.js";
import type { AgentManagedSession } from "@/types/session/SessionOptions.js";
import { project_agent_interaction } from "@/session/storage/SessionInteractionReader.js";

/** 所有来源共用的交互集合，生命周期跟随 Agent。 */
export class AgentInteractions implements AgentInteractionCollection {
  /** 订阅者集合不复制 canonical Interaction 状态。 */
  private readonly listeners = new Set<(change: AgentInteractionChange) => void>();
  /** 原集合移除事件的取消函数。 */
  private readonly unsubscribe_removed: () => void;
  /** Agent 释放后拒绝继续读取或响应。 */
  private disposed = false;

  constructor(private readonly options: AgentInteractionsOptions) {
    this.unsubscribe_removed = options.sessions.on_removed((event) => {
      this.emit({ type: "removed", session_category: event.category, session_id: event.session_id });
    });
  }

  /** 存储只读取活动 Session 的非终态消息，不调用 sessions.get。 */
  async list(input?: AgentListInteractionsInput) {
    this.assert_active();
    if (input?.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1)) {
      throw new Error("Agent interactions limit must be a positive integer");
    }
    const items = await this.options.get_store().list_pending_interactions();
    const sessions = this.options.sessions.list_cached_sessions();
    for (const item of items) {
      const session = sessions.find((candidate) => candidate.id === item.reference.session_id
        && candidate.origin.category === item.reference.session_category);
      item.can_respond = session?.can_respond_interaction(item.reference.interaction_id, item.reference.turn_id) ?? false;
    }
    items.sort((left, right) => left.interaction.request.created_at - right.interaction.request.created_at
      || left.reference.session_category.localeCompare(right.reference.session_category)
      || left.reference.session_id.localeCompare(right.reference.session_id)
      || left.reference.interaction_id.localeCompare(right.reference.interaction_id));
    return input?.limit === undefined ? items : items.slice(0, input.limit);
  }

  /** 同步注册未来变化，调用方可先订阅再读取快照。 */
  subscribe(listener: (change: AgentInteractionChange) => void): () => void {
    this.assert_active();
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** 复用原 Session 的串行校验、持久化及执行恢复。 */
  async respond(input: AgentRespondInteractionInput) {
    const session = this.resolve_session(input);
    return await session.respond({
      interaction_id: input.reference.interaction_id,
      expected_turn_id: input.reference.turn_id,
      response: input.response,
    });
  }

  /** 私密答案仅进入受信原 Session 专用入口，不经过事件或额外存储。 */
  async submit_private(input: AgentRespondInteractionInput) {
    const session = this.resolve_session(input);
    return await session.submit_private_question({
      interaction_id: input.reference.interaction_id,
      expected_turn_id: input.reference.turn_id,
      response: input.response,
    });
  }

  /**
   * 由 AgentSessions 在缓存实例时装配，早于 initialize 和首个 Turn。
   * 同时覆盖创建、恢复和 fork；返回值由 Session 缓存拥有者在释放时调用。
   */
  observe_session(session: AgentManagedSession): () => void {
    this.assert_active();
    const unsubscribe = session.subscribe((mutation) => this.project_mutation(session, mutation));
    return () => {
      unsubscribe();
      this.emit({ type: "removed", session_category: session.origin.category, session_id: session.id });
    };
  }

  /** 释放集合订阅，Session 实例订阅由 AgentSessions 同步释放。 */
  dispose(): void {
    this.disposed = true;
    this.unsubscribe_removed();
    this.listeners.clear();
  }

  /** 公开引用必须完整匹配，缺少运行态时明确失败，不通过读操作重启执行。 */
  private resolve_session(input: AgentRespondInteractionInput): AgentSession {
    this.assert_active();
    const reference = input.reference;
    if (!reference || [reference.session_category, reference.session_id, reference.turn_id, reference.interaction_id]
      .some((value) => typeof value !== "string" || !value.trim())) {
      throw new Error("Agent Interaction requires a complete Session/Turn/Interaction reference");
    }
    const session = this.options.sessions.list_cached_sessions().find((candidate) =>
      candidate.id === reference.session_id && candidate.origin.category === reference.session_category);
    if (!session) throw new Error("Agent Interaction original Session is not running; the request cannot be resumed");
    return session;
  }

  /** 只处理包含 canonical Tool 快照的 mutation，文本增量不触发查询。 */
  private project_mutation(session: AgentManagedSession, mutation: SessionMutation): void {
    if (mutation.variant === "session" && mutation.type === "truncate") {
      this.emit({ type: "removed", session_category: session.origin.category, session_id: session.id });
      return;
    }
    const parts = mutation.variant === "part" && mutation.type === "tool" ? [mutation.part]
      : mutation.variant === "message" && mutation.role === "agent" ? mutation.message.parts : [];
    for (const part of parts) {
      if (part.type !== "tool") continue;
      for (const interaction of part.interactions ?? []) {
        const can_respond = interaction.status === "pending"
          && session.can_respond_interaction(interaction.interaction_id, interaction.request.turn_id);
        this.emit({ type: "updated", item: project_agent_interaction(session.id, session.origin.category, interaction, can_respond, session.origin) });
      }
    }
  }

  /** 每个订阅者取得独立快照，观察失败不影响已提交的 Session mutation。 */
  private emit(change: AgentInteractionChange): void {
    if (this.disposed) return;
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(change));
      } catch (error) {
        this.options.logger.error("Agent interaction listener failed", { error: String(error) });
      }
    }
  }

  /** 保证 Agent 释放后的句柄不可继续使用。 */
  private assert_active(): void {
    if (this.disposed) throw new Error("Agent interactions are disposed");
  }
}
