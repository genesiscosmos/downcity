/** City 通知事实端口：唯一 Power 接收器持有状态；集合观察只传原事实，没有宿主回退存储。 */
import type { Agent, Group } from "@downcity/agent";
import type { PowerNotificationPublisher, PowerNotificationReceiver, PowerNotificationSource, PowerNotificationFact } from "@/power/types/PowerNotification.js";

/** 生命周期内只有一个持久通知接收方，避免Desktop与Power各存一份未读。 */
export class CityNotifications {
  private receiver?: PowerNotificationReceiver;
  private closing = false;
  /** 接收器持有期间的只读观察，移除主体或插件时立即释放。 */
  private readonly observers = new Map<Agent | Group, () => void>();

  /** 注册接收方并返回精确撤销函数。 */
  register(receiver: PowerNotificationReceiver, agents: readonly Agent[], groups: readonly Group[] = []): () => void {
    if (this.receiver) throw new Error("A notification receiver is already registered");
    this.receiver = receiver;
    try {
      for (const agent of agents) this.attach_agent(agent);
      for (const group of groups) this.attach_group(group);
    }
    catch (error) { this.clear(); throw error; }
    return () => { if (this.receiver === receiver) this.clear(); };
  }

  /** 新主体通过同一Agent集合事件接入，不依赖某个Session是否在页面打开。 */
  attach_agent(agent: Agent): void {
    if (!this.receiver || this.observers.has(agent)) return;
    const release_interactions = agent.interactions.subscribe(() => this.receiver?.interactions_changed?.());
    const release_removals = agent.sessions.on_removed(() => this.sources_changed());
    const release_creation = agent.sessions.on_created(() => this.sources_changed());
    const release_directory = agent.sessions.on_directory_changed(() => this.sources_changed());
    this.observers.set(agent, () => { release_interactions(); release_removals(); release_creation(); release_directory(); });
    this.sources_changed();
    this.receiver.interactions_changed?.();
  }

  /** 主体移除只撤销观察，通知的展示策略由接收器刷新决定。 */
  detach_agent(agent: Agent): void {
    this.observers.get(agent)?.();
    this.observers.delete(agent);
    this.sources_changed();
    if (!this.closing) this.receiver?.interactions_changed?.();
  }

  /** Group 集合观察覆盖页面打开之外的执行，策略由 Notification Power 解释。 */
  attach_group(group: Group): void {
    if (!this.receiver || this.observers.has(group)) return;
    const release_events = group.sessions.on_event(async (session_id, event) => {
      if (event.type === "title") this.sources_changed();
      await this.notify_fact({ type: "group_event", group_id: group.id, session_id, event });
    });
    const release_removals = group.sessions.on_removed(() => this.sources_changed());
    const release_directory = group.sessions.on_directory_changed(() => this.sources_changed());
    this.observers.set(group, () => { release_events(); release_removals(); release_directory(); });
    this.sources_changed();
  }

  /** Group 移除释放所有观察并提交主体消失事实。 */
  detach_group(group: Group): void {
    this.observers.get(group)?.();
    this.observers.delete(group);
    this.sources_changed();
  }

  /** Workspace 登记或移除使目录事实失效，清理策略由 Power 解释。 */
  targets_changed(): void { this.sources_changed(); }

  /** 生命周期回调只同步失效展示，不等待任何存储 IO。 */
  private sources_changed(): void { if (!this.closing) this.receiver?.sources_changed?.(); }

  /** 展示投影失败不能回滚已提交的原主体生命周期。 */
  private async notify_fact(fact: PowerNotificationFact): Promise<void> {
    if (this.closing) return;
    try { await this.receiver?.fact_changed?.(fact); }
    catch (error) { console.warn("Notification fact delivery failed", error); }
  }

  /** City 退出只是释放运行资源，不是删除主体；停止观察，保留持久通知。 */
  begin_shutdown(): void {
    this.closing = true;
    for (const release of this.observers.values()) release();
    this.observers.clear();
  }

  /** 插件关闭不保留对主体或执行会话的引用。 */
  private clear(): void {
    this.receiver = undefined;
    for (const release of this.observers.values()) release();
    this.observers.clear();
  }

  /** 来源由受信宿主绑定，延迟选择接收方覆盖Power初始化顺序。 */
  publisher(source: PowerNotificationSource): PowerNotificationPublisher {
    return {
      publish: async (input) => {
        if (this.receiver) return await this.receiver.publish(source, input);
        throw new Error("Notification Power is unavailable");
      },
      dismiss: async (input) => {
        if (this.receiver) return await this.receiver.dismiss(source, input);
        throw new Error("Notification Power is unavailable");
      },
    };
  }
}
