/**
 * RemoteAgent 的主体交互集合。
 *
 * 监听器同步注册，首次 list 等待服务端订阅就绪，覆盖 subscribe/list 之间的变化。
 * 集合不缓存交互状态；断线后 list 会重建订阅并读取 canonical 快照。
 */
import type {
  AgentInteractionChange,
  AgentInteractionCollection,
  AgentListInteractionsInput,
  AgentRespondInteractionInput,
} from "@downcity/agent";
import type { RemoteAgentInteractionTransport } from "@/types/remote/RemoteAgentInteractions.js";
import type { TransportSubscription } from "./RemoteTransport.js";

/** 共享单个 Agent 事件连接，不拥有原交互的处理状态。 */
export class RemoteAgentInteractions implements AgentInteractionCollection {
  private readonly listeners = new Set<(change: AgentInteractionChange) => void>();
  private connection: Promise<TransportSubscription> | undefined;
  private generation = 0;
  private closed = false;

  constructor(private readonly transport: RemoteAgentInteractionTransport) {}

  /** 先等待已经请求的订阅，再读取待处理列表。 */
  async list(input?: AgentListInteractionsInput) {
    this.assert_open();
    if (this.listeners.size) await this.ensure_connection();
    return await this.transport.list_interactions(input);
  }

  /** 同步注册监听；取消最后一个监听器时关闭底层连接。 */
  subscribe(listener: (change: AgentInteractionChange) => void): () => void {
    this.assert_open();
    this.listeners.add(listener);
    // 接口没有异步错误回调；连接失败通过下一次 list 返回，并允许重新建立连接。
    void this.ensure_connection().catch(() => undefined);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.disconnect();
    };
  }

  /** 普通响应始终使用普通协议入口。 */
  async respond(input: AgentRespondInteractionInput) {
    this.assert_open();
    return await this.transport.respond_interaction(input);
  }

  /** 私密答案只通过原 Session 专用入口传递。 */
  async submit_private(input: AgentRespondInteractionInput) {
    this.assert_open();
    return await this.transport.submit_private_interaction(input);
  }

  /** 由 RemoteAgentCore.close 释放同步监听与异步连接。 */
  close(): void {
    this.closed = true;
    this.listeners.clear();
    this.disconnect();
  }

  /** 就绪 Promise 也是首次查询的订阅屏障。 */
  private ensure_connection(): Promise<TransportSubscription> {
    if (this.connection) return this.connection;
    const generation = ++this.generation;
    const connection = this.transport.subscribe_interactions({
      on_event: (change) => {
        if (generation !== this.generation || this.closed) return;
        for (const listener of this.listeners) {
          try { listener(structuredClone(change)); } catch { /* 单个观察者不影响事件连接。 */ }
        }
      },
      on_close: () => {
        if (generation === this.generation) {
          this.generation += 1;
          this.connection = undefined;
        }
      },
    }).then(async (subscription) => {
      if (generation !== this.generation || this.closed) {
        await subscription.close();
        throw new Error("Remote Agent interaction subscription closed");
      }
      return subscription;
    }).catch((error: unknown) => {
      if (generation === this.generation) this.connection = undefined;
      throw error;
    });
    this.connection = connection;
    return connection;
  }

  /** 允许正在握手的连接完成后立即释放，避免快速取消造成泄漏。 */
  private disconnect(): void {
    this.generation += 1;
    const connection = this.connection;
    this.connection = undefined;
    if (connection) void connection.then((subscription) => subscription.close()).catch(() => undefined);
  }

  private assert_open(): void {
    if (this.closed) throw new Error("Remote Agent interactions closed");
  }
}
