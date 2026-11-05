/**
 * Notification Power：用户Inbox。聚合原Interaction并保存普通更新，不拥有执行或审批状态。
 * Desktop 默认装配唯一实例；用户动作只注册宿主入口，不编译为模型工具。
 */
import { Power } from "@downcity/city/power";
import type { PowerLifecycleContext, PowerHooks, PowerJsonValue, PowerInteractionResponse, PowerNotificationTarget, PowerNotificationFact, PowerNotificationInput, PowerNotificationSource, PowerNotificationTargets } from "@downcity/city/power";
import type { SessionTurnCommittedHookValue } from "@downcity/type";
import { z } from "zod";
import { NotificationStore } from "./NotificationStore.js";
import type { NotificationPowerOptions } from "./types/NotificationOptions.js";
import type { NotificationListResult } from "./types/NotificationRenderer.js";
import { NotificationQuery } from "./NotificationQuery.js";
import { notification_target_key, notification_target_schema as target_schema } from "./NotificationIdentity.js";
import { session_notification, source_availability } from "./NotificationPolicy.js";

/** 来源引用由宿主校验，模型没有审批入口。 */
const reference_schema = z.object({ session_category: z.enum(["chat", "work"]), session_id: z.string().min(1),
  turn_id: z.string().min(1), interaction_id: z.string().min(1) }).strict();
const response_schema = z.object({ agent_id: z.string().min(1), reference: reference_schema,
  response: z.object({ type: z.string(), outcome: z.string(), payload: z.json() }).passthrough() }).strict();

/** 普通更新动作只接收明确的快照引用，不能按主题或当前全部记录模糊操作。 */
const update_reference_schema = z.object({ notification_id: z.string().min(1), created_at: z.number().finite() }).strict();
const update_snapshot_schema = z.object({ updates: z.array(update_reference_schema) }).strict();

/** 一个City中的通知插件；每条更新保留发布Agent与Power归属。 */
export class NotificationPower extends Power {
  readonly name = "notification";
  readonly title = "Inbox";
  readonly description = "User inbox for pending interactions and work updates.";
  private context?: PowerLifecycleContext;
  private store?: NotificationStore;
  private unregister?: () => void;
  private query?: NotificationQuery;
  /** 启动和来源生命周期入口维护的目录事实，供纯查询投影可达性。 */
  private source_directory?: PowerNotificationTargets;
  private revision = 0;
  private snapshot?: NotificationListResult;
  /** 最后交付快照用于识别未知来源恢复，向所有消费者发布同一版本。 */
  private last_snapshot?: NotificationListResult;
  private in_flight?: Promise<NotificationListResult>;
  /** 目录对账只由明确写入口串行执行，查询不会触发持久化操作。 */
  private reconciliation: Promise<void> = Promise.resolve();
  private readonly visible_targets = new Map<string, PowerNotificationTarget>();

  constructor(private readonly options: NotificationPowerOptions = {}) { super(); }

  /** 宿主刷新失败只影响展示，不改变已经提交的业务事实。 */
  private changed(): void {
    this.revision += 1;
    this.snapshot = undefined;
    void Promise.resolve().then(() => this.options.on_changed?.()).catch((error: unknown) => {
      this.context?.logger.warn("Inbox refresh failed", { error: String(error) });
    });
  }

  readonly hooks: PowerHooks = { effect: { "session.turn_committed": [Object.assign(async ({ context, value }) => {
    const event = value as unknown as SessionTurnCommittedHookValue;
    const input = session_notification(context.agent.id, context.snapshot.session_origin, event);
    if (input) await this.publish({ source_kind: "session", power_id: this.name, agent_id: context.agent.id }, input);
  }, { handler_id: "work_update" })] } };

  async initialize(context: PowerLifecycleContext): Promise<void> {
    this.context = context;
    this.store = new NotificationStore(context.storage);
    this.query = new NotificationQuery(context, this.store, () => this.source_directory);
    this.unregister = context.system.register_notification_receiver({
      interactions_changed: () => this.changed(),
      fact_changed: async (fact) => await this.handle_fact(fact),
      publish: async (source, input) => await this.publish(source, { ...input,
        target: { kind: "power", power_id: source.power_id, route: input.route ?? {} } }),
      dismiss: async (source, input) => { if (await this.require_store().dismiss(source, input.topic_key)) this.changed(); },
    });
    context.power.action({ id: "notification.list", run: async () => await this.read_snapshot() as unknown as PowerJsonValue });
    context.power.action({ id: "notification.refresh_sources", run: async () => {
      await this.reconcile_sources();
      this.changed();
      return { status: "refreshed" };
    } });
    context.power.action({ id: "notification.view", run: async (input) => {
      const value = z.object({ view_id: z.string().min(1), visible: z.boolean(), target: target_schema.optional() }).strict().parse(input);
      await this.observe_view(value.view_id, value.visible ? value.target as PowerNotificationTarget | undefined : undefined);
      return { status: "observed" };
    } });
    context.power.action({ id: "notification.read", run: async (input) => {
      const { notification_id, created_at } = z.object({ notification_id: z.string().min(1), created_at: z.number() }).parse(input);
      if (await this.require_store().mark_read(notification_id, created_at)) this.changed();
      return { status: "read", snapshot: await this.read_snapshot() as unknown as PowerJsonValue };
    } });
    context.power.action({ id: "notification.read_updates", run: async (input) => {
      const { updates } = update_snapshot_schema.parse(input);
      if (await this.require_store().update_inbox(updates, "read")) this.changed();
      return { status: "read", snapshot: await this.read_snapshot() as unknown as PowerJsonValue };
    } });
    context.power.action({ id: "notification.clear_update", run: async (input) => {
      const update = update_reference_schema.parse(input);
      if (await this.require_store().update_inbox([update], "clear")) this.changed();
      return { status: "cleared", snapshot: await this.read_snapshot() as unknown as PowerJsonValue };
    } });
    context.power.action({ id: "notification.clear_read_updates", run: async (input) => {
      const { updates } = update_snapshot_schema.parse(input);
      if (await this.require_store().update_inbox(updates, "clear_read")) this.changed();
      return { status: "cleared", snapshot: await this.read_snapshot() as unknown as PowerJsonValue };
    } });
    context.power.action({ id: "notification.respond", run: async (input) => {
      const value = response_schema.parse(input) as unknown as PowerInteractionResponse;
      const result = await context.system.respond_agent_interaction(value);
      this.changed();
      return result;
    } });
    await this.reconcile_sources();
    this.changed();
  }

  dispose(): void {
    this.unregister?.();
    this.unregister = undefined;
    this.context = undefined;
    this.store = undefined;
    this.query = undefined;
    this.source_directory = undefined;
    this.snapshot = undefined;
    this.last_snapshot = undefined;
    this.visible_targets.clear();
  }

  /** 受信宿主同步撤销失焦窗口，再异步持久化可见原会话的普通更新已读。 */
  observe_view(view_id: string, target?: PowerNotificationTarget): Promise<void> {
    if (!target || target.kind === "power") { this.visible_targets.delete(view_id); return Promise.resolve(); }
    const parsed = target_schema.parse(target) as PowerNotificationTarget;
    this.visible_targets.set(view_id, parsed);
    return this.require_store().mark_target_read(parsed, () => this.visible_targets.get(view_id) === parsed).then((changed) => { if (changed) this.changed(); });
  }

  /** 所有消费者共用一份版本快照，变更发生在读取中时重读，不丢失在途事件。 */
  private async read_snapshot(): Promise<NotificationListResult> {
    if (this.snapshot) return this.snapshot;
    if (this.in_flight) return await this.in_flight;
    const query = this.query;
    if (!query) throw new Error("Notification Power is not initialized");
    const operation = (async () => {
      for (;;) {
        const revision = this.revision;
        const snapshot = await query.snapshot(revision);
        if (query !== this.query) throw new Error("Notification Power was disposed");
        if (revision !== this.revision) continue;
        if (this.last_snapshot?.revision === revision && JSON.stringify(this.last_snapshot) !== JSON.stringify(snapshot)) {
          this.changed();
          snapshot.revision = this.revision;
        }
        this.last_snapshot = snapshot;
        // 未知主体允许显式重试；恢复变化通过同一变更通道刷新其他消费者。
        if (!snapshot.unavailable_agents.length && !snapshot.unavailable_groups.length) this.snapshot = snapshot;
        return snapshot;
      }
    })();
    this.in_flight = operation;
    try { return await operation; } finally { if (this.in_flight === operation) this.in_flight = undefined; }
  }

  /** 写入、可见目标规则和版本变更均属于 Power。 */
  private async publish(source: PowerNotificationSource, input: PowerNotificationInput): Promise<void> {
    const is_visible = () => !!input.target && [...this.visible_targets.values()].some((target) => notification_target_key(target) === notification_target_key(input.target!));
    if (await this.require_store().publish(source, input, is_visible)) this.changed();
  }

  /** 原 Group 事实按群聊聚合；生命周期改变来源状态，保留摘要与未读。 */
  private async handle_fact(fact: PowerNotificationFact): Promise<void> {
    if (fact.type === "group_event") {
      if (fact.event.type === "status" && fact.event.phase === "failed") {
        const target: PowerNotificationTarget = { kind: "group_session", group_id: fact.group_id, session_id: fact.session_id };
        await this.publish({ source_kind: "group", power_id: this.name }, {
          topic_key: notification_target_key(target), event_id: fact.event.turn_id ?? fact.event.message_id, target, kind: "update", scope: "inbox", outcome: "failure", title: "群聊执行失败" });
      } else if (fact.event.type === "interaction") this.changed();
      return;
    }
    await this.reconcile_sources(fact);
    this.changed();
  }

  /** 启动与明确集合更新才对账；文件写入不属于 snapshot/list 的职责。 */
  private async reconcile_sources(fact?: PowerNotificationFact): Promise<void> {
    const context = this.context;
    const store = this.require_store();
    const operation = this.reconciliation.then(async () => {
      if (!context || context !== this.context) return;
      const directory = await context.system.list_notification_targets();
      if (context !== this.context) return;
      // 原主体提交的明确生命周期事实优先于同一时刻仍在收尾的集合目录。
      if (fact?.type === "agent_removed") directory.agent_ids = directory.agent_ids.filter((id) => id !== fact.agent_id);
      if (fact?.type === "group_removed") directory.group_ids = directory.group_ids.filter((id) => id !== fact.group_id);
      if (fact?.type === "target_removed") {
        const key = notification_target_key(fact.target);
        directory.targets = directory.targets.filter((target) => notification_target_key(target) !== key);
        directory.archived_targets = directory.archived_targets.filter((target) => notification_target_key(target) !== key);
        if (fact.reason === "archived") directory.archived_targets.push(fact.target);
      }
      this.source_directory = directory;
      const changed = await store.reconcile((item) => {
        if (fact?.type === "target_removed" && notification_target_key(item.target) === notification_target_key(fact.target)) return fact.reason;
        if (fact?.type === "agent_removed" && (item.agent_id === fact.agent_id || (item.target.kind === "agent_session" && item.target.agent_id === fact.agent_id))) return "removed";
        if (fact?.type === "group_removed" && item.target.kind === "group_session" && item.target.group_id === fact.group_id) return "removed";
        return source_availability(item.target, item.agent_id, directory);
      });
      if (changed) this.changed();
    });
    this.reconciliation = operation.catch((error: unknown) => context?.logger.warn("Inbox source reconciliation failed", { error: String(error) }));
    await operation;
  }

  private require_store(): NotificationStore {
    if (!this.store || !this.context) throw new Error("Notification Power is not initialized");
    return this.store;
  }
}
