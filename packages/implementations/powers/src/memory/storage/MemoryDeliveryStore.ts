/** Memory 反馈订阅账本：独立于 Job，允许同一处理结果向多个真实调用方可靠回传。 */
import { createHash } from "node:crypto";
import type { MemoryResultRecipient, MemoryResultSubscription } from "../types/MemoryDelivery.js";
import { FileMemoryStorageAdapter } from "../adapters/FileMemoryStorageAdapter.js";

/** 文件操作通过与实际根绑定的范围锁串行，写入采用 Adapter 原子发布。 */
export class MemoryDeliveryStore {
  /** 独立反馈目录的文件存储。 */
  private readonly storage: FileMemoryStorageAdapter;
  constructor(root_path: string) { this.storage = new FileMemoryStorageAdapter({ root_path }); }

  /** 为同一 Job 与真实调用轮次创建唯一订阅，调用重放不会多次发送。 */
  async subscribe(job_id: string, recipient: MemoryResultRecipient): Promise<void> {
    const subscription_id = createHash("sha256").update(JSON.stringify([job_id, recipient.agent_id,
      recipient.type, recipient.session_id, recipient.caller_turn_id])).digest("hex");
    await this.storage.with_scope_lock("delivery-state", async () => {
      const key = this.key(subscription_id);
      if (await this.storage.has(key)) return;
      const value: MemoryResultSubscription = { subscription_id, job_id, recipient, attempts: 0 };
      await this.storage.write(key, JSON.stringify(value));
    });
  }

  /** 一次读取待检查订阅；权威修改仍在独立锁内完成。 */
  async list(): Promise<MemoryResultSubscription[]> {
    return (await this.storage.list("records-v2/subscriptions")).map((entry) => JSON.parse(entry.content) as MemoryResultSubscription);
  }

  /** 单个订阅的检查、发送和确认在同一执行锁内完成，避免多实例重复工作。 */
  async process(subscription_id: string, run: (value: MemoryResultSubscription, save: (value: MemoryResultSubscription) => Promise<void>) => Promise<void>): Promise<void> {
    await this.storage.with_scope_lock(`delivery:${subscription_id}`, async () => {
      const key = this.key(subscription_id);
      const content = await this.storage.read(key);
      if (!content) return;
      await run(JSON.parse(content) as MemoryResultSubscription, async (value) => {
        if (value.subscription_id !== subscription_id) throw new Error("Cannot change Memory delivery identity");
        await this.storage.write(key, JSON.stringify(value));
      });
    });
  }

  /** 不接受模型提供的路径或任意文件名。 */
  private key(subscription_id: string): string {
    if (!/^[a-f0-9]{64}$/u.test(subscription_id)) throw new Error("Invalid Memory delivery ID");
    return `records-v2/subscriptions/${subscription_id}.json`;
  }
}
