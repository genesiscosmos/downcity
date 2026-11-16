/** Notification存储：更新按来源稳定键幂等保存，已读由用户控制；原执行结果不复制到这里。 */
import { z } from "zod";
import { createHash } from "node:crypto";
import type { PowerStorage, PowerNotificationInput, PowerNotificationSource, PowerNotificationTarget } from "@downcity/city/power";
import type { NotificationRecord, NotificationUpdateReference } from "./types/Notification.js";
import { notification_target_matches, notification_target_schema } from "./NotificationIdentity.js";

/** 只解析通知内容与阅读状态；来源可达性等派生字段不进入存储协议。 */
const item_schema = z.object({
  notification_id: z.string().min(1), power_id: z.string().min(1), agent_id: z.string().min(1).optional(),
  source_kind: z.enum(["session", "group", "power"]), topic_key: z.string().min(1), event_id: z.string().min(1).optional(),
  title: z.string(), body: z.string().optional(), target: notification_target_schema,
  kind: z.enum(["reply", "update"]), scope: z.enum(["inbox", "session"]), outcome: z.enum(["success", "failure", "info"]),
  created_at: z.number(), read: z.boolean(),
}).strip();

/** 对象键顺序不影响重复发布判断。 */
function canonical_json(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical_json).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical_json(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** 所有更改共享文件锁，生命周期重建后仍复用同一通知身份。 */
export class NotificationStore {
  /** 同一存储实例中的版本时钟，清除后立即重发也不能复用已交付版本。 */
  private last_created_at = 0;

  constructor(private readonly storage: PowerStorage) {}

  async publish(source: PowerNotificationSource, input: PowerNotificationInput, is_visible: () => boolean = () => false): Promise<boolean> {
    const notification_id = createHash("sha256").update(JSON.stringify([source.source_kind, source.power_id, source.agent_id ?? null, input.topic_key])).digest("hex");
    const target = input.target ?? { kind: "power" as const, power_id: source.power_id, route: input.route ?? {} };
    const { kind, scope, outcome } = input;
    return await this.mutate(async (items) => {
      const previous = items.find((item) => item.notification_id === notification_id);
      if (previous && input.event_id && previous.event_id === input.event_id) return items;
      if (previous && canonical_json([previous.title, previous.body, previous.target, previous.kind, previous.scope, previous.outcome, previous.event_id])
        === canonical_json([input.title, input.body || undefined, target, kind, scope, outcome, input.event_id])) return items;
      const created_at = Math.max(Date.now(), this.last_created_at + 1);
      this.last_created_at = created_at;
      return [{ notification_id, ...source, topic_key: input.topic_key,
        title: input.title, ...(input.body ? { body: input.body } : {}), ...(input.event_id ? { event_id: input.event_id } : {}),
        target, kind, scope, outcome, created_at, read: is_visible() }, ...items.filter((item) => item.notification_id !== notification_id)];
    });
  }

  async list(): Promise<NotificationRecord[]> {
    if (!await this.storage.files.path_exists("notifications.json")) return [];
    const items: unknown = JSON.parse((await this.storage.files.read_file("notifications.json")).toString("utf8"));
    return z.array(item_schema).parse(items);
  }

  async mark_read(notification_id: string, created_at: number): Promise<boolean> {
    return await this.mutate(async (items) => items.map((item) => item.notification_id === notification_id
      && item.created_at === created_at ? { ...item, read: true } : item));
  }

  /** 快照操作在同一文件锁内核对范围、身份与版本；批量清除还须当前仍已读。 */
  async update_inbox(updates: readonly NotificationUpdateReference[], operation: "read" | "clear" | "clear_read"): Promise<boolean> {
    const versions = new Map(updates.map((item) => [item.notification_id, item.created_at]));
    return await this.mutate(async (items) => items.flatMap((item) => {
      if (item.scope !== "inbox" || versions.get(item.notification_id) !== item.created_at) return [item];
      if (operation === "read") return [{ ...item, read: true }];
      return operation === "clear_read" && !item.read ? [item] : [];
    }));
  }

  async dismiss(source: PowerNotificationSource, topic_key: string): Promise<boolean> {
    return await this.mutate(async (items) => items.filter((item) => !(item.source_kind === source.source_kind && item.power_id === source.power_id
      && item.agent_id === source.agent_id && item.topic_key === topic_key)));
  }

  /** 可见目标只确认普通更新，绝不修改原 Interaction。 */
  async mark_target_read(target: PowerNotificationTarget, is_visible: () => boolean = () => true): Promise<boolean> {
    return await this.mutate(async (items) => !is_visible() ? items
      : items.map((item) => notification_target_matches(item.target, target) ? { ...item, read: true } : item));
  }

  private async mutate(change: (items: NotificationRecord[]) => Promise<NotificationRecord[]>): Promise<boolean> {
    await this.storage.files.ensure_directory(".");
    return await this.storage.files.with_file_lock("notifications.lock", async () => {
      const previous = await this.list();
      for (const item of previous) this.last_created_at = Math.max(this.last_created_at, item.created_at);
      const items = await change(previous);
      if (JSON.stringify(previous) === JSON.stringify(items)) return false;
      await this.storage.files.write_file_atomically("notifications.json", JSON.stringify(z.array(item_schema).parse(items)));
      return true;
    });
  }
}
