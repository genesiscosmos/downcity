/** City的通知端口装配：Notification Power持有状态，宿主仅在未注册Power时提供可选回退。 */
import type { Agent } from "@downcity/agent";
import type { PowerNotificationPublisher, PowerNotificationReceiver, PowerNotificationSource } from "@/power/types/PowerNotification.js";

/** 生命周期内只有一个持久通知接收方，避免Desktop与Power各存一份未读。 */
export class CityNotifications {
  private receiver?: PowerNotificationReceiver;
  /** 接收器持有期间的只读观察，移除主体或插件时立即释放。 */
  private readonly observers = new Map<Agent, () => void>();

  /** 注册接收方并返回精确撤销函数。 */
  register(receiver: PowerNotificationReceiver, agents: readonly Agent[]): () => void {
    if (this.receiver) throw new Error("A notification receiver is already registered");
    this.receiver = receiver;
    try { for (const agent of agents) this.attach_agent(agent); }
    catch (error) { this.clear(); throw error; }
    return () => { if (this.receiver === receiver) this.clear(); };
  }

  /** 新主体通过同一Agent集合事件接入，不依赖某个Session是否在页面打开。 */
  attach_agent(agent: Agent): void {
    if (!this.receiver || this.observers.has(agent)) return;
    this.observers.set(agent, agent.interactions.subscribe(() => this.receiver?.interactions_changed?.()));
    this.receiver.interactions_changed?.();
  }

  /** 主体移除只撤销观察，通知的展示策略由接收器刷新决定。 */
  detach_agent(agent: Agent): void {
    this.observers.get(agent)?.();
    this.observers.delete(agent);
    this.receiver?.interactions_changed?.();
  }

  /** 插件关闭不保留对主体或执行会话的引用。 */
  private clear(): void {
    this.receiver = undefined;
    for (const release of this.observers.values()) release();
    this.observers.clear();
  }

  /** 来源由受信宿主绑定，延迟选择接收方覆盖Power初始化顺序。 */
  publisher(source: PowerNotificationSource, fallback?: PowerNotificationPublisher): PowerNotificationPublisher {
    return {
      publish: async (input) => {
        if (this.receiver) return await this.receiver.publish(source, input);
        if (fallback) return await fallback.publish(input);
        throw new Error("Notification Power is unavailable");
      },
      dismiss: async (input) => {
        if (this.receiver) return await this.receiver.dismiss(source, input);
        if (fallback) return await fallback.dismiss(input);
      },
    };
  }
}
