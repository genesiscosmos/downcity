/** 将 Agent Session Turn 完成事件转换为通用 Desktop Notification。 */

import type { DesktopChatRuntime } from "../../common/types/DesktopApi.js";
import type { DesktopNotificationPublisher } from "../types/notification/Notification.js";

/** 监听 Session 运行态，并且每个 Turn 最多发布一次完成通知。 */
export class SessionTurnNotificationProducer {
  /** 通用 Desktop 通知发布端口。 */
  private readonly notifications: DesktopNotificationPublisher;
  /** 每个 Session 最近已经处理的完成 Turn，防止重复终态事件重新触发通知。 */
  private readonly completed_turn_by_topic = new Map<string, string>();

  constructor(notifications: DesktopNotificationPublisher) {
    this.notifications = notifications;
  }

  /** 消费一条 Session 运行态；非完成终态不会产生通知。 */
  handle_runtime(runtime: DesktopChatRuntime): void {
    if (runtime.status !== "completed" || !runtime.turn_id) return;
    const target = {
      kind: "agent_session" as const,
      agent_id: runtime.agent_id,
      workspace_id: runtime.workspace_id,
      session_id: runtime.session_id,
    };
    const topic_key = `session_turn_completed:agent_session:${runtime.agent_id}:${runtime.workspace_id}:${runtime.session_id}`;
    if (this.completed_turn_by_topic.get(topic_key) === runtime.turn_id) return;
    this.completed_turn_by_topic.set(topic_key, runtime.turn_id);
    this.notifications.publish({
      kind: "session_turn_completed",
      topic_key,
      target,
      scopes: [{ kind: "agent", agent_id: runtime.agent_id }],
      title: "对话已完成",
      created_at: runtime.updated_at,
    });
  }
}
