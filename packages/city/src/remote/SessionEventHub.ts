/**
 * SessionEventHub：统一 Session Mutation 分发器。
 *
 * 关键点（中文）
 * - 收口 `Session.subscribe()` 的订阅/取消订阅能力。
 * - 只做未来事件广播，不做缓存、重放或背压管理。
 */

import type {
  SessionMutation,
  SessionMutationSubscriber,
  SessionMutationUnsubscribe,
} from "@downcity/agent";

/**
 * SessionEventHub：最小事件总线实现。
 */
export class SessionEventHub {
  private readonly subscribers = new Map<number, SessionMutationSubscriber>();
  private next_subscriber_id = 1;

  /**
   * 注册一个新的 Session 事件订阅者。
   */
  subscribe(subscriber: SessionMutationSubscriber): SessionMutationUnsubscribe {
    const id = this.next_subscriber_id;
    this.next_subscriber_id += 1;
    this.subscribers.set(id, subscriber);

    return () => {
      this.subscribers.delete(id);
    };
  }

  /**
   * 广播一条 Session 事件。
   */
  publish(mutation: SessionMutation): void {
    for (const subscriber of this.subscribers.values()) {
      try {
        Promise.resolve(subscriber(mutation)).catch(() => undefined);
      } catch {
        // ignore single subscriber failures
      }
    }
  }
}
