/**
 * Notification Power：用户Inbox。聚合原Interaction并保存普通更新，不拥有执行或审批状态。
 * 用户动作仅注册宿主入口，不编译为模型工具；禁用本Power不影响Session交互。
 */
import { Power } from "@downcity/city/power";
import type { PowerLifecycleContext, PowerHooks, PowerJsonValue, PowerInteractionResponse } from "@downcity/city/power";
import type { SessionTurnCommittedHookValue } from "@downcity/type";
import { z } from "zod";
import { NotificationStore } from "./NotificationStore.js";
import type { NotificationPowerOptions } from "./types/NotificationOptions.js";

/** 来源引用由宿主校验，模型没有审批入口。 */
const reference_schema = z.object({ session_category: z.enum(["chat", "work"]), session_id: z.string().min(1),
  turn_id: z.string().min(1), interaction_id: z.string().min(1) }).strict();
const response_schema = z.object({ agent_id: z.string().min(1), reference: reference_schema,
  response: z.object({ type: z.string(), outcome: z.string(), payload: z.json() }).passthrough() }).strict();

/** 一个City中的通知插件；每条更新保留发布Agent与Power归属。 */
export class NotificationPower extends Power {
  readonly name = "notification";
  readonly title = "Inbox";
  readonly description = "User inbox for pending interactions and work updates.";
  private context?: PowerLifecycleContext;
  private store?: NotificationStore;
  private unregister?: () => void;

  constructor(private readonly options: NotificationPowerOptions = {}) { super(); }

  /** 宿主刷新失败只影响展示，不改变已经提交的业务事实。 */
  private changed(): void {
    void Promise.resolve().then(() => this.options.on_changed?.()).catch((error: unknown) => {
      this.context?.logger.warn("Inbox refresh failed", { error: String(error) });
    });
  }

  readonly hooks: PowerHooks = { effect: { "session.turn_committed": [Object.assign(async ({ context, value }) => {
    const event = value as unknown as SessionTurnCommittedHookValue;
    const origin = context.snapshot.session_origin;
    // Child结果交给Main，Task/Memory内部步骤由业务Power交付，避免重复打扰。
    if (origin?.category !== "work" || origin.type !== "work" || origin.delegation_depth === 2 || event.status === "stopped") return;
    await this.require_store().publish({ power_id: this.name, agent_id: context.agent.id }, {
      topic_key: event.completion_id,
      title: event.status === "completed" ? "工作已完成" : "工作执行失败",
      body: (event.result.text || event.result.error || "").slice(0, 1600),
      route: { agent_id: context.agent.id, session_id: event.session_id, session_category: origin.category },
    });
    this.changed();
  }, { handler_id: "work_update" })] } };

  initialize(context: PowerLifecycleContext): void {
    this.context = context;
    this.store = new NotificationStore(context.storage);
    this.unregister = context.system.register_notification_receiver({
      interactions_changed: () => this.changed(),
      publish: async (source, input) => { await this.require_store().publish(source, input); this.changed(); },
      dismiss: async (source, input) => { await this.require_store().dismiss(source, input.topic_key); this.changed(); },
    });
    context.power.action({ id: "notification.list", run: async (input) => {
      const filter = z.object({ agent_id: z.string().optional() }).parse(input ?? {});
      const agents = (await context.system.list_agents()).filter((agent) => !filter.agent_id || agent.agent_id === filter.agent_id);
      const interactions: PowerJsonValue[] = [];
      const unavailable_agents: string[] = [];
      await Promise.all(agents.map(async (agent) => {
        try {
          const pending = await context.system.list_agent_interactions({ agent_id: agent.agent_id });
          if (!Array.isArray(pending)) throw new Error("Invalid Agent interaction list");
          for (const item of pending) interactions.push({ agent_id: agent.agent_id, agent_name: agent.name, interaction: item });
        } catch (error) {
          unavailable_agents.push(agent.agent_id);
          context.logger.warn("Inbox Agent is temporarily unavailable", { agent_id: agent.agent_id, error: String(error) });
        }
      }));
      const items = (await this.require_store().list()).filter((item) => !filter.agent_id || item.agent_id === filter.agent_id);
      const agent_names = Object.fromEntries(agents.map((agent) => [agent.agent_id, agent.name]));
      return { items, interactions, unavailable_agents, agent_names } as unknown as PowerJsonValue;
    } });
    context.power.action({ id: "notification.read", run: async (input) => {
      const { notification_id } = z.object({ notification_id: z.string().min(1) }).parse(input);
      await this.require_store().mark_read(notification_id);
      this.changed();
      return { status: "read" };
    } });
    context.power.action({ id: "notification.respond", run: async (input) => {
      const value = response_schema.parse(input) as unknown as PowerInteractionResponse;
      const result = await context.system.respond_agent_interaction(value);
      this.changed();
      return result;
    } });
    this.changed();
  }

  dispose(): void {
    this.unregister?.();
    this.unregister = undefined;
    this.context = undefined;
    this.store = undefined;
  }

  private require_store(): NotificationStore {
    if (!this.store || !this.context) throw new Error("Notification Power is not initialized");
    return this.store;
  }
}
