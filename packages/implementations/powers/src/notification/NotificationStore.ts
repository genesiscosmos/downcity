/** Notification存储：更新按来源稳定键幂等保存，已读由用户控制；原执行结果不复制到这里。 */
import { createHash } from "node:crypto";
import type { PowerStorage, PowerNotificationInput, PowerNotificationSource } from "@downcity/city/power";
import type { NotificationItem } from "./types/Notification.js";

/** 所有更改共享文件锁，生命周期重建后仍复用同一通知身份。 */
export class NotificationStore {
  constructor(private readonly storage: PowerStorage) {}

  async publish(source: PowerNotificationSource, input: PowerNotificationInput): Promise<void> {
    const notification_id = createHash("sha256").update(JSON.stringify([source.power_id, source.agent_id ?? null, input.topic_key])).digest("hex");
    await this.mutate(async (items) => {
      const previous = items.find((item) => item.notification_id === notification_id);
      if (previous && JSON.stringify([previous.title, previous.body, previous.route]) === JSON.stringify([input.title, input.body, input.route])) return items;
      return [{ notification_id, ...source, topic_key: input.topic_key,
        title: input.title, ...(input.body ? { body: input.body } : {}), ...(input.route ? { route: input.route } : {}),
        created_at: Date.now(), read: false }, ...items.filter((item) => item.notification_id !== notification_id)];
    });
  }

  async list(): Promise<NotificationItem[]> {
    if (!await this.storage.files.path_exists("notifications.json")) return [];
    const items = JSON.parse((await this.storage.files.read_file("notifications.json")).toString("utf8")) as NotificationItem[];
    if (!Array.isArray(items)) throw new Error("Invalid notification store");
    return items;
  }

  async mark_read(notification_id: string): Promise<void> {
    await this.mutate(async (items) => items.map((item) => item.notification_id === notification_id ? { ...item, read: true } : item));
  }

  async dismiss(source: PowerNotificationSource, topic_key: string): Promise<void> {
    await this.mutate(async (items) => items.map((item) => item.power_id === source.power_id
      && item.agent_id === source.agent_id && item.topic_key === topic_key ? { ...item, read: true } : item));
  }

  private async mutate(change: (items: NotificationItem[]) => Promise<NotificationItem[]>): Promise<void> {
    await this.storage.files.ensure_directory(".");
    await this.storage.files.with_file_lock("notifications.lock", async () => {
      const items = await change(await this.list());
      await this.storage.files.write_file_atomically("notifications.json", JSON.stringify(items));
    });
  }
}
