/**
 * 单个Inbox工作区的临时UI状态。两个插槽共用一次轮询，引用计数在离开页面时释放。
 * 不保存交互答案，选择保留失效项让用户了解变化，不在刷新中自动跳往另一张表单。
 */
import type { PowerActionGateway } from "@downcity/city/power/react";
import type { InboxEntry, InboxState, InboxView } from "../types/Inbox.js";
import type { NotificationListResult } from "../types/NotificationRenderer.js";
import { inbox_entries, interaction_key } from "./InboxEntries.js";

/** 只缓存公开快照和界面状态，不拥有业务状态与执行生命周期。 */
export class InboxStore {
  private state: InboxState = { loading: true, error: "", selected: {}, handled: new Set() };
  private readonly listeners = new Set<() => void>();
  private readonly gateways = new Map<symbol, PowerActionGateway>();
  private timer?: ReturnType<typeof setInterval>;
  private in_flight?: Promise<void>;
  private generation = 0;
  /** 本地已确认操作用于阻止在途旧查询回退UI，真实状态仍由服务器持有。 */
  private readonly read_keys = new Map<string, number>();

  readonly get_snapshot = (): InboxState => this.state;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** 每个插槽借用同一数据源，离开最后一个插槽才释放刷新。 */
  attach(gateway: PowerActionGateway): () => void {
    const key = Symbol();
    this.gateways.set(key, gateway);
    if (!this.timer) {
      void this.refresh();
      this.timer = setInterval(() => { void this.refresh(); }, 2000);
    }
    return () => {
      this.gateways.delete(key);
      if (!this.gateways.size) {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        this.generation += 1;
        this.patch({ dirty_key: undefined, busy_key: undefined });
      }
    };
  }

  /** 请求不重叠；后台失败保留当前内容，首次失败也结束占位。 */
  refresh = async (): Promise<void> => {
    if (this.in_flight) return await this.in_flight;
    const gateway = this.gateways.values().next().value;
    if (!gateway) return;
    const generation = this.generation;
    const operation = (async () => {
      try {
        const received = await gateway.invoke<NotificationListResult>("notification.list", {});
        if (generation !== this.generation) return;
        const data: NotificationListResult = { ...received,
          interactions: received.interactions.filter((item) => !this.state.handled.has(interaction_key(item))),
          items: received.items.map((item) => this.read_keys.get(item.notification_id) === item.created_at ? { ...item, read: true } : item),
        };
        const selected = { ...this.state.selected };
        for (const view of ["pending", "updates"] as const) {
          const entries = inbox_entries(data, view);
          const previous = selected[view];
          selected[view] = previous ? entries.find((item) => item.key === previous.key) ?? previous
            : view === "updates" ? entries.find((item) => item.unread) ?? entries[0] : entries[0];
        }
        this.patch({ data, selected, loading: false, error: "" });
      } catch (error) {
        if (generation === this.generation) this.patch({ loading: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    this.in_flight = operation;
    try { await operation; } finally { if (this.in_flight === operation) this.in_flight = undefined; }
  };

  select(entry: InboxEntry): void {
    this.patch({ selected: { ...this.state.selected, [entry.view]: entry }, dirty_key: undefined });
  }

  dirty(key: string): void { if (this.state.dirty_key !== key) this.patch({ dirty_key: key }); }
  busy(key?: string): void { this.patch({ busy_key: key }); }
  clear_dirty(): void { this.patch({ dirty_key: undefined }); }

  /** 提交确认保留原项，不把用户瞬间切换到下一项。 */
  handled(entry: InboxEntry): void {
    const handled = new Set(this.state.handled).add(entry.key);
    const data = this.state.data;
    this.patch({ handled, dirty_key: undefined, data: data ? { ...data,
      interactions: data.interactions.filter((item) => interaction_key(item) !== entry.key) } : data });
  }

  /** 只更新当前可见快照，服务器仍是已读事实源。 */
  read(key: string): void {
    const data = this.state.data;
    if (!data) return;
    const item = data.items.find((item) => item.notification_id === key);
    if (item) this.read_keys.set(key, item.created_at);
    this.patch({ data: { ...data, items: data.items.map((item) => item.notification_id === key ? { ...item, read: true } : item) } });
  }

  private patch(change: Partial<InboxState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
}
