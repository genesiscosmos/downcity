/**
 * 单个 Inbox 工作区的临时 UI 状态。两个插槽共用事件驱动读取，在途失效合并重读。
 * 不保存交互答案，选择保留失效项让用户了解变化，不在刷新中自动跳往另一张表单。
 */
import type { PowerActionGateway } from "@downcity/city/power/react";
import type { InboxEntry, InboxState } from "../types/Inbox.js";
import type { NotificationListResult, NotificationUpdateResult } from "../types/NotificationRenderer.js";
import { inbox_entries } from "./InboxEntries.js";

/** 只缓存公开快照和界面状态，不拥有业务状态与执行生命周期。 */
export class InboxStore {
  private state: InboxState = { loading: true, error: "", handled: new Set() };
  private readonly listeners = new Set<() => void>();
  private readonly gateways = new Map<symbol, PowerActionGateway>();
  private refresh_pending = false;
  private in_flight?: Promise<void>;
  private generation = 0;

  readonly get_snapshot = (): InboxState => this.state;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** 每个插槽借用同一数据源，离开最后一个插槽才释放刷新。 */
  attach(gateway: PowerActionGateway): () => void {
    const key = Symbol();
    this.gateways.set(key, gateway);
    if (this.gateways.size === 1) void this.refresh();
    return () => {
      this.gateways.delete(key);
      if (!this.gateways.size) {
        this.refresh_pending = false;
        this.generation += 1;
        this.patch({ dirty_key: undefined, busy_key: undefined });
      }
    };
  }

  /** 请求不重叠；后台失败保留当前内容，首次失败也结束占位。 */
  refresh = async (): Promise<void> => {
    if (this.in_flight) { this.refresh_pending = true; return await this.in_flight; }
    const gateway = this.gateways.values().next().value;
    if (!gateway) return;
    const generation = this.generation;
    const operation = (async () => {
      try {
        const received = await gateway.invoke<NotificationListResult>("notification.list", {});
        if (generation !== this.generation) return;
        this.receive(received);
      } catch (error) {
        if (generation === this.generation) this.patch({ loading: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    this.in_flight = operation;
    try { await operation; } finally {
      if (this.in_flight === operation) this.in_flight = undefined;
      if (this.refresh_pending && this.gateways.size) { this.refresh_pending = false; void this.refresh(); }
    }
  };

  select(entry: InboxEntry): void {
    this.patch({ selected: entry, dirty_key: undefined });
  }

  /** 关闭详情后保留列表位置，不自动选择下一项。 */
  close(): void {
    this.patch({ selected: undefined, dirty_key: undefined });
  }

  dirty(key: string): void { if (this.state.dirty_key !== key) this.patch({ dirty_key: key }); }
  busy(key?: string): void { this.patch({ busy_key: key }); }
  clear_dirty(): void { this.patch({ dirty_key: undefined }); }

  /** 提交确认保留原项，不把用户瞬间切换到下一项。 */
  handled(entry: InboxEntry): void {
    const handled = new Set(this.state.handled).add(entry.key);
    this.patch({ handled, dirty_key: undefined });
  }

  /** 详情自动阅读复用 Power 的版本检查和完整快照，不在 UI 重算计数。 */
  async mark_read(notification_id: string, created_at: number): Promise<void> {
    const gateway = this.gateways.values().next().value;
    if (!gateway) return;
    const result = await gateway.invoke<NotificationUpdateResult>("notification.read", { notification_id, created_at });
    this.receive(result.snapshot);
  }

  /** 点击时固定当前 Inbox 普通更新快照；返回 Power 的最终快照，迟到查询不能回退它。 */
  async update_notifications(operation: "read" | "clear" | "clear_read", entry?: InboxEntry): Promise<void> {
    if (this.state.update_action) return;
    const gateway = this.gateways.values().next().value;
    if (!gateway || !this.state.data) return;
    const items = entry?.update ? [entry.update] : this.state.data.items;
    const updates = items.filter((item) => item.scope === "inbox" && (operation !== "clear_read" || item.read))
      .map(({ notification_id, created_at }) => ({ notification_id, created_at }));
    if (!updates.length || (operation === "clear" && !entry?.update)) return;
    const action = operation === "read" ? "notification.read_updates" : operation === "clear" ? "notification.clear_update" : "notification.clear_read_updates";
    this.patch({ update_action: entry?.key ?? operation, update_error: "" });
    try {
      const result = await gateway.invoke<NotificationUpdateResult>(action, operation === "clear" ? updates[0] : { updates });
      this.receive(result.snapshot);
    } catch (error) {
      this.patch({ update_error: error instanceof Error ? error.message : String(error) });
    } finally { this.patch({ update_action: undefined }); }
  }

  /** 整体接收 Power 快照，列表、组成和数字始终来自同一版本。 */
  private receive(data: NotificationListResult): void {
    if (this.state.data && data.revision < this.state.data.revision) return;
    const previous = this.state.selected;
    const selected = previous ? inbox_entries(data, "all").find((item) => item.key === previous.key)
      ?? (previous.pending ? previous : undefined) : undefined;
    this.patch({ data, selected, loading: false, error: "" });
  }

  private patch(change: Partial<InboxState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
}
