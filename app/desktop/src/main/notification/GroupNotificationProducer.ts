/**
 * 将 GroupSession 的需要用户注意的落点转换为通用 Desktop Notification。
 *
 * Group 只通知「需要人处理」的两种情况：成员 Agent 等待输入/确认，以及本轮执行失败。
 * 与 Agent Session 一致，一个 GroupSession 只保留一条未读通知并始终反映最近落点。
 */

import type { DesktopGroupEvent } from "../../common/types/DesktopApi.js";
import type { DesktopNotificationKind } from "../../common/types/DesktopNotification.js";
import type { DesktopNotificationPublisher } from "../types/notification/Notification.js";

/** Group 未读通知当前支持的落点。 */
type GroupAttentionKind = Extract<DesktopNotificationKind, "group_interaction_pending" | "group_turn_failed">;

/** 每个落点对应的用户可见标题。 */
const group_attention_title: Record<GroupAttentionKind, string> = {
  group_interaction_pending: "群聊等待你的输入",
  group_turn_failed: "群聊执行失败",
};

/** 一个 GroupSession 最近一次已通知的落点，用于去重与收回判断。 */
interface GroupAttention {
  /** 当前未读通知表达的落点。 */
  kind: GroupAttentionKind;
  /** 最近一次已通知的待处理交互标识。 */
  interaction_id?: string;
  /** 最近一次已通知的失败 Turn 标识。 */
  turn_id?: string;
}

/** 监听 GroupSession 事件，并把需要用户注意的落点收敛成一条未读通知。 */
export class GroupNotificationProducer {
  /** 通用 Desktop 通知发布端口。 */
  private readonly notifications: DesktopNotificationPublisher;
  /** 每个 GroupSession 最近一次已通知的落点。 */
  private readonly attention_by_topic = new Map<string, GroupAttention>();

  constructor(notifications: DesktopNotificationPublisher) {
    this.notifications = notifications;
  }

  /** 消费一条 GroupSession 事件；不表达注意力的事件不会产生通知。 */
  handle_event(event: DesktopGroupEvent): void {
    const topic_key = get_group_topic_key(event.group_id, event.session_id);
    const previous = this.attention_by_topic.get(topic_key);

    if (event.type === "interaction") {
      // 同一交互重复到达时不再打扰；新交互会覆盖上一条未读通知。
      if (previous?.kind === "group_interaction_pending" && previous.interaction_id === event.request.interaction_id) return;
      this.attention_by_topic.set(topic_key, { kind: "group_interaction_pending", interaction_id: event.request.interaction_id });
      this.publish(topic_key, event.group_id, event.session_id, "group_interaction_pending");
      return;
    }
    if (event.type !== "status") return;

    if (event.phase === "failed") {
      if (previous?.kind === "group_turn_failed" && event.turn_id && previous.turn_id === event.turn_id) return;
      this.attention_by_topic.set(topic_key, { kind: "group_turn_failed", ...(event.turn_id ? { turn_id: event.turn_id } : {}) });
      this.publish(topic_key, event.group_id, event.session_id, "group_turn_failed");
      return;
    }
    // 回到空闲或已停止说明本轮不再有待处理交互，同步收回尚未查看的等待通知。
    if ((event.phase === "idle" || event.phase === "stopped") && previous?.kind === "group_interaction_pending") {
      this.attention_by_topic.delete(topic_key);
      this.notifications.mark_topic_read(topic_key);
    }
  }

  /** 发布一条绑定 Group 生命周期作用域的未读通知。 */
  private publish(topic_key: string, group_id: string, session_id: string, kind: GroupAttentionKind): void {
    this.notifications.publish({
      kind,
      topic_key,
      target: { kind: "group_session", group_id, session_id },
      scopes: [{ kind: "group", group_id }],
      title: group_attention_title[kind],
      created_at: Date.now(),
    });
  }
}

/** 生成 GroupSession 未读通知的稳定聚合键。 */
export function get_group_topic_key(group_id: string, session_id: string): string {
  return `group_session:${group_id}:${session_id}`;
}
