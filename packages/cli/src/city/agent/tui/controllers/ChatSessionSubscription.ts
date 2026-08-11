/**
 * Chat TUI 当前 Session 的订阅与快照同步资源。
 *
 * 该对象拥有一个 RemoteSession 引用及其取消订阅函数。激活 Session 时先订阅并
 * 缓冲 Mutation，再读取完整快照并回放缓冲，保证 TUI 不会在初始化窗口丢事件。
 */

import type {
  RemoteAgentSession,
  SessionMutation,
  SessionMutationUnsubscribe,
} from "@downcity/agent";

import type {
  ChatSessionSnapshot,
  ChatSessionSubscriptionOptions,
} from "@/city/types/ChatSessionSubscription.js";

/** 管理 Chat TUI 当前 RemoteSession 的完整订阅生命周期。 */
export class ChatSessionSubscription {
  private readonly options: ChatSessionSubscriptionOptions;
  private active_session: RemoteAgentSession | null = null;
  private target_session_id = "";
  private unsubscribe: SessionMutationUnsubscribe | null = null;
  private generation = 0;
  private snapshot_ready = false;
  private buffered_mutations: SessionMutation[] = [];

  /** @param options 远程 Agent 与状态投影回调。 */
  constructor(options: ChatSessionSubscriptionOptions) {
    this.options = options;
  }

  /** 当前已经激活的 RemoteSession；初始化或释放后为空。 */
  get session(): RemoteAgentSession | null {
    return this.active_session;
  }

  /** 切换到指定 Session，并完成订阅、快照与缓冲 Mutation 的无缝合并。 */
  async activate(session_id: string): Promise<void> {
    const generation = this.generation + 1;
    this.generation = generation;
    this.release_resources();
    this.target_session_id = session_id;

    try {
      const session = await this.options.remote_agent.sessions.get(session_id);
      if (!this.is_current(generation, session_id)) return;
      this.active_session = session;
      this.unsubscribe = session.subscribe((mutation) => {
        if (!this.is_current(generation, session_id)) return;
        if (!this.snapshot_ready) {
          this.buffered_mutations.push(mutation);
          return;
        }
        this.options.on_mutation(mutation);
      });

      const [info, messages, status, interactions] = await Promise.all([
        session.get_info(),
        session.messages(),
        session.status(),
        session.interactions(),
      ]);
      if (!this.is_current(generation, session_id)) return;

      const snapshot: ChatSessionSnapshot = {
        session_id,
        title: info.title?.trim() || "Untitled",
        messages: messages.items,
        security: status.security,
        is_executing: status.state === "running",
        interactions,
      };
      this.options.on_snapshot(snapshot);

      // 关键点（中文）：快照替换与缓冲回放保持在同一个同步区段，避免二次竞态窗口。
      for (const mutation of this.buffered_mutations) {
        this.options.on_mutation(mutation);
      }
      this.buffered_mutations = [];
      this.snapshot_ready = true;
    } catch (error) {
      if (generation === this.generation) this.release_resources();
      throw error;
    }
  }

  /** 取消当前订阅并使尚未完成的激活流程失效。 */
  dispose(): void {
    this.generation += 1;
    this.release_resources();
  }

  /** 判断异步结果是否仍属于当前激活请求。 */
  private is_current(generation: number, session_id: string): boolean {
    return generation === this.generation && this.target_session_id === session_id;
  }

  /** 释放订阅资源并清空仅属于旧 Session 的缓冲状态。 */
  private release_resources(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.active_session = null;
    this.target_session_id = "";
    this.snapshot_ready = false;
    this.buffered_mutations = [];
  }
}
