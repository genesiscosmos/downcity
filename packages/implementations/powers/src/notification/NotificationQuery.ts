/** 通知只读投影：按实际引用解析来源，原 Interaction 和阅读状态各自保持唯一拥有者。 */
import type { AgentInteraction } from "@downcity/agent";
import type { PowerLifecycleContext, PowerNotificationTarget, PowerNotificationResolution } from "@downcity/city/power";
import type { NotificationInteractionItem, NotificationListResult, NotificationAttention } from "./types/NotificationRenderer.js";
import { NotificationStore } from "./NotificationStore.js";
import { notification_interaction_key, notification_source_key } from "./NotificationIdentity.js";
import { interaction_target, notification_session_title } from "./NotificationPolicy.js";

/** 最后已知请求仅用于断连展示，不维护任何会话目录或持久来源状态。 */
export class NotificationQuery {
  private readonly known_interactions = new Map<string, NotificationInteractionItem[]>();

  constructor(private readonly context: PowerLifecycleContext, private readonly store: NotificationStore) {}

  /** 每次只读实际通知和请求引用；查询不修改通知文件或阅读版本。 */
  async snapshot(revision: number): Promise<NotificationListResult> {
    const agents = await this.context.system.list_agents();
    const agent_ids = new Set(agents.map(agent => agent.agent_id));
    const unavailable_agents = new Set<string>();
    const unavailable_groups = new Set<string>();
    await Promise.all(agents.map(async agent => {
      try {
        const pending = await this.context.system.list_agent_interactions({ agent_id: agent.agent_id });
        if (!Array.isArray(pending)) throw new Error("Invalid Agent interaction list");
        const previous = new Map((this.known_interactions.get(agent.agent_id) ?? []).map(item => [notification_interaction_key(item), item]));
        this.known_interactions.set(agent.agent_id, (pending as unknown as AgentInteraction[]).map(interaction => {
          const item: NotificationInteractionItem = { agent_id: agent.agent_id, agent_name: agent.name, interaction,
            target: interaction_target(agent.agent_id, interaction.reference.session_id, interaction.origin), availability: "unknown" };
          item.session_title = previous.get(notification_interaction_key(item))?.session_title;
          return item;
        }));
      } catch (error) {
        unavailable_agents.add(agent.agent_id);
        this.context.logger.warn("Inbox Agent is temporarily unavailable", { agent_id: agent.agent_id, error: String(error) });
      }
    }));
    const records = await this.store.list();
    const references = new Map<string, PowerNotificationTarget>();
    for (const item of [...records, ...[...this.known_interactions.values()].flat()]) {
      if (item.target) references.set(notification_source_key(item.target), item.target);
    }
    const targets = [...references.values()];
    let resolved: PowerNotificationResolution[] = [];
    try { if (targets.length) resolved = await this.context.system.resolve_notification_targets(targets); }
    catch (error) { this.context.logger.warn("Inbox sources are temporarily unavailable", { error: String(error) }); }
    const sources = new Map<string, PowerNotificationResolution>(targets.map((target, index) => [notification_source_key(target),
      resolved[index] ?? { target, availability: "unknown" }]));
    const source_for = (target: PowerNotificationTarget | undefined) => target ? sources.get(notification_source_key(target)) : undefined;
    const interactions = [...new Map([...this.known_interactions.values()].flat().map(known => {
      const removed = !agent_ids.has(known.agent_id);
      const unknown = unavailable_agents.has(known.agent_id);
      const source = source_for(known.target);
      const item: NotificationInteractionItem = { ...known, target: source?.target ?? known.target,
        session_title: notification_session_title(source) ?? known.session_title,
        availability: removed ? "removed" : unknown ? "unknown" : source?.availability ?? "unknown",
        interaction: removed || unknown ? { ...known.interaction, can_respond: false } : known.interaction };
      return [notification_interaction_key(item), item] as const;
    })).values()];
    // 仅保留原请求的最后已知展示快照，来源恢复后仍向原主体重新读取。
    for (const agent of agents) this.known_interactions.set(agent.agent_id, interactions.filter(item => item.agent_id === agent.agent_id));
    const items = records.map(item => {
      const source = source_for(item.target);
      const owner_removed = item.agent_id && !agent_ids.has(item.agent_id);
      return { ...item, target: source?.target ?? item.target, title: notification_session_title(source) ?? item.title,
        availability: owner_removed ? "removed" as const : source?.availability ?? "unknown" as const };
    });
    for (const item of [...items, ...interactions]) {
      if (item.availability !== "unknown") continue;
      if (item.target?.kind === "group_session") unavailable_groups.add(item.target.group_id);
      else if (item.target?.kind === "agent_session") unavailable_agents.add(item.target.agent_id);
    }
    const notifications: NotificationAttention[] = items.filter(item => !item.read).map(item => ({ ...item }));
    for (const item of interactions) {
      if (!item.interaction.can_respond) continue;
      const request = item.interaction.interaction.request;
      notifications.push({ notification_id: notification_interaction_key(item), topic_key: notification_interaction_key(item),
        kind: "request", scope: "inbox", outcome: "info", source_kind: !item.target ? "unknown" : item.target.kind === "group_session" ? "group" : "session",
        availability: item.availability, target: item.target, title: item.session_title || request.title || "等待你的回应", created_at: request.created_at });
    }
    notifications.sort((left, right) => right.created_at - left.created_at || left.notification_id.localeCompare(right.notification_id));
    const pending_request_count = notifications.filter(item => item.kind === "request").length;
    const unread_updates = items.filter(item => item.scope === "inbox" && !item.read);
    const unread_failure_count = unread_updates.filter(item => item.outcome === "failure").length;
    return { revision, pending_request_count, unread_update_count: unread_updates.length, unread_failure_count,
      badge_count: pending_request_count + unread_failure_count, notifications, items, interactions,
      agent_names: Object.fromEntries(agents.map(agent => [agent.agent_id, agent.name])),
      unavailable_agents: [...unavailable_agents], unavailable_groups: [...unavailable_groups] };
  }
}
