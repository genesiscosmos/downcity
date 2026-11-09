/**
 * Notification Power 的统一只读投影。原 Interaction 每次向 Agent 查询，普通更新来自唯一存储；
 * 缓存仅保留断连时的最后一次已知请求，断连不等于已处理。目录核对不恢复执行器。
 */
import type { AgentInteraction } from "@downcity/agent";
import type { PowerLifecycleContext, PowerNotificationTargets } from "@downcity/city/power";
import type { NotificationInteractionItem, NotificationListResult, NotificationAttention } from "./types/NotificationRenderer.js";
import { NotificationStore } from "./NotificationStore.js";
import { notification_interaction_key } from "./NotificationIdentity.js";
import { interaction_target, source_availability, notification_session_title } from "./NotificationPolicy.js";

/** 最后已知请求只在 Power 生命周期中保留；来源目录由明确更新入口提供，不在查询中对账。 */
export class NotificationQuery {
  private readonly known_interactions = new Map<string, NotificationInteractionItem[]>();

  constructor(private readonly context: PowerLifecycleContext, private readonly store: NotificationStore,
    private readonly get_directory: () => PowerNotificationTargets | undefined) {}

  /** 原子发布前的快照查询，由调用方合并并发并检查 Power 版本。 */
  async snapshot(revision: number): Promise<NotificationListResult> {
    const agents = await this.context.system.list_agents();
    const agent_ids = new Set(agents.map((agent) => agent.agent_id));
    const unavailable_agents = new Set<string>();
    const directory = this.get_directory();
    await Promise.all(agents.map(async (agent) => {
      try {
        const pending = await this.context.system.list_agent_interactions({ agent_id: agent.agent_id });
        if (!Array.isArray(pending)) throw new Error("Invalid Agent interaction list");
        this.known_interactions.set(agent.agent_id, (pending as unknown as AgentInteraction[]).map((interaction) => {
          const target = interaction_target(agent.agent_id, interaction.reference.session_id, interaction.origin);
          return { agent_id: agent.agent_id, agent_name: agent.name, interaction, target,
            availability: target && directory ? source_availability(target, agent.agent_id, directory) : "unknown" };
        }));
      } catch (error) {
        unavailable_agents.add(agent.agent_id);
        this.context.logger.warn("Inbox Agent is temporarily unavailable", { agent_id: agent.agent_id, error: String(error) });
      }
    }));
    const interactions = [...new Map([...this.known_interactions.values()].flat().map((known) => {
      const removed = !agent_ids.has(known.agent_id);
      const unknown = unavailable_agents.has(known.agent_id);
      const session_title = known.target ? notification_session_title(known.target, directory) : undefined;
      const current = { ...known, session_title: session_title ?? known.session_title };
      const item: NotificationInteractionItem = removed || unknown ? { ...current,
        availability: removed ? "removed" : "unknown", interaction: { ...known.interaction, can_respond: false } } : current;
      return [notification_interaction_key(item), item] as const;
    })).values()];
    // 展示标题跟随目录元数据，改名不会重发通知或修改已读版本。
    const items = (await this.store.list()).map((item) => {
      const title = notification_session_title(item.target, directory);
      return title === undefined ? item : { ...item, title };
    });
    for (const item of items) {
      if (item.availability !== "unknown") continue;
      const agent_id = item.agent_id ?? (item.target.kind === "agent_session" ? item.target.agent_id : undefined);
      if (agent_id) unavailable_agents.add(agent_id);
    }
    const notifications: NotificationAttention[] = items.filter((item) => !item.read).map((item) => ({ ...item }));
    for (const item of interactions) {
      if (!item.interaction.can_respond) continue;
      const request = item.interaction.interaction.request;
      notifications.push({ notification_id: notification_interaction_key(item), topic_key: notification_interaction_key(item),
        kind: "request", scope: "inbox", outcome: "info", source_kind: !item.target ? "unknown" : item.target.kind === "group_session" ? "group" : "session",
        availability: item.availability, target: item.target, title: item.session_title || request.title || "等待你的回应", created_at: request.created_at });
    }
    notifications.sort((left, right) => right.created_at - left.created_at || left.notification_id.localeCompare(right.notification_id));
    const pending_request_count = notifications.filter((item) => item.kind === "request").length;
    const unread_updates = items.filter((item) => item.scope === "inbox" && !item.read);
    const unread_failure_count = unread_updates.filter((item) => item.outcome === "failure").length;
    return { revision, pending_request_count, unread_update_count: unread_updates.length, unread_failure_count,
      badge_count: pending_request_count + unread_failure_count, notifications, items, interactions,
      agent_names: Object.fromEntries(agents.map((agent) => [agent.agent_id, agent.name])),
      unavailable_agents: [...unavailable_agents], unavailable_groups: [...new Set(items.filter((item) => item.availability === "unknown" && item.target.kind === "group_session")
        .map((item) => item.target.kind === "group_session" ? item.target.group_id : ""))] };
  }
}
