/**
 * 将 Power 发布意图转换为 Desktop Notification。
 *
 * 宿主在这里绑定 Power 身份并命名空间化 topic，Power 无法代表其他 Power 发布
 * 通知，也不能构造 Desktop 的任意导航目标。
 */

import type {
  DesktopNotificationPublisher,
  DesktopPowerNotificationInput,
} from "../types/notification/Notification.js";
import type { DesktopNotificationScope } from "../../common/types/DesktopNotification.js";

/** Power 通知发布到 Desktop 唯一事实源的适配器。 */
export class PowerNotificationProducer {
  /** Desktop 通知唯一事实源的发布端口。 */
  private readonly notifications: DesktopNotificationPublisher;

  constructor(notifications: DesktopNotificationPublisher) {
    this.notifications = notifications;
  }

  /** 发布一条已绑定当前 Power 身份的通知。 */
  publish(power_id_input: string, input: DesktopPowerNotificationInput, agent_id_input?: string): void {
    const power_id = require_text(power_id_input, "power_id");
    const topic_key = require_text(input.topic_key, "topic_key");
    const scopes: DesktopNotificationScope[] = [{ kind: "power", power_id }];
    if (agent_id_input !== undefined) {
      scopes.push({ kind: "agent", agent_id: require_text(agent_id_input, "agent_id") });
    }
    this.notifications.publish({
      kind: "power",
      topic_key: `power:${power_id}:${topic_key}`,
      target: {
        kind: "power",
        power_id,
        route: input.route ? structuredClone(input.route) : {},
      },
      scopes,
      title: input.title,
      ...(input.body ? { body: input.body } : {}),
      created_at: Date.now(),
    });
  }

  /** 清除当前 Power 命名空间内一个主题的未读通知。 */
  dismiss(power_id_input: string, topic_key_input: string): void {
    const power_id = require_text(power_id_input, "power_id");
    const topic_key = require_text(topic_key_input, "topic_key");
    this.notifications.mark_topic_read(`power:${power_id}:${topic_key}`);
  }
}

/** 读取一段非空协议文本。 */
function require_text(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`power notification ${field} is required`);
  return normalized;
}
