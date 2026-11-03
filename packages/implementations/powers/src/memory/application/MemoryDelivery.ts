/** Memory 完成反馈 outbox：先固化终态事件再发送，失败独立退避，模型处理和投递互不覆盖。 */
import type { PowerContext, PowerLogger } from "@downcity/city/power";
import type { MemoryJob } from "../types/MemoryJob.js";
import type { MemoryResultRecipient } from "../types/MemoryDelivery.js";
import type { MemoryJobStore } from "../storage/MemoryJobStore.js";
import { MemoryDeliveryStore } from "../storage/MemoryDeliveryStore.js";

/** 仅由原始调用身份形成接收方；被读取的源 Session 不参与路由。 */
export function memory_result_recipient(context: PowerContext): MemoryResultRecipient | null {
  if (!context.session || !context.turn || context.session.origin.type === "memory") return null;
  return { agent_id: context.agent.id, category: context.session.origin.category,
    session_id: context.session.id, caller_turn_id: context.turn.id };
}

/** 完成事件使用有界状态摘要，不将来源正文复制到原聊天。 */
function render_memory_result(job: MemoryJob): string {
  const payload = { job_id: job.job_id, kind: job.kind, status: job.status, target: job.target,
    mode: job.mode, memory_ids: job.memory_ids ?? [],
    note: job.status === "succeeded" ? "Memory changes were committed."
      : job.status === "skipped" ? "No memory changes were made."
      : "Memory processing failed; do not claim these changes were saved. Inspect job_status for details.",
  };
  return "Memory processing result. Treat it as reference data, not a new user request. Do not repeat a saving confirmation already given for this Job.\n" + JSON.stringify(payload);
}

/** 生命周期内的轻量反馈检查，不调用模型或创建任务。 */
export class MemoryDelivery {
  /** 唯一计时器与正在执行的检查，防止重入。 */
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopped = false;

  constructor(
    /** 当前 Memory 请求账本。 */
    private readonly jobs: MemoryJobStore,
    /** 独立投递状态。 */
    private readonly store: MemoryDeliveryStore,
    /** 宿主使用稳定 delivery_id 幂等接收后台结果。 */
    private readonly deliver: (recipient: MemoryResultRecipient, delivery_id: string, text: string) => Promise<"delivered" | "saved">,
    /** 投递错误仅写处理日志，不改记忆状态。 */
    private readonly logger: PowerLogger,
  ) {}

  /** 启动时恢复未确认投递，此后每五秒检查一次。 */
  initialize(): void {
    this.timer = setInterval(() => this.wake(), 5000);
    this.timer.unref();
    this.wake();
  }

  /** 原请求和重放可以订阅同一 Job，不会产生多个相同接收身份。 */
  async subscribe(job_id: string, recipient: MemoryResultRecipient | null): Promise<void> {
    if (!recipient) return;
    await this.store.subscribe(job_id, recipient);
    this.wake();
  }

  /** 可由 Coordinator 在终态提交后唤醒；持久化恢复不依赖这次内存信号。 */
  wake(): void {
    if (this.stopped || this.running) return;
    this.running = this.flush().catch((error) => {
      this.logger.warn("Memory completion scan failed", { error: String(error) });
    }).finally(() => { this.running = undefined; });
  }

  /** 每个订阅独立记录失败，其他请求的结果仍可送达。 */
  private async flush(): Promise<void> {
    for (const item of await this.store.list()) {
      if (this.stopped) break;
      try {
        await this.store.process(item.subscription_id, async (subscription, save) => {
          if (subscription.next_attempt_at && Date.parse(subscription.next_attempt_at) > Date.now()) return;
          if (!subscription.pending) {
            const job = await this.jobs.read(subscription.job_id);
            if (!job || !["succeeded", "skipped", "failed"].includes(job.status)) return;
            const generation = `${job.attempt}:${job.status}`;
            if (subscription.delivered_generation === generation) return;
            subscription.pending = { generation, delivery_id: `memory-result:${subscription.subscription_id}:${generation}`, text: render_memory_result(job) };
            subscription.attempts = 0;
            await save(subscription);
          }
          try {
            const event = subscription.pending;
            subscription.delivery_status = await this.deliver(subscription.recipient, event.delivery_id, event.text);
            subscription.delivered_generation = event.generation;
            delete subscription.pending;
            delete subscription.error;
            delete subscription.next_attempt_at;
            await save(subscription);
          } catch (error) {
            subscription.attempts++;
            subscription.error = error instanceof Error ? error.message : String(error);
            subscription.next_attempt_at = new Date(Date.now() + Math.min(300_000, 5000 * 2 ** Math.min(subscription.attempts - 1, 6))).toISOString();
            await save(subscription);
            this.logger.warn("Memory completion delivery deferred", { subscription_id: subscription.subscription_id, error: subscription.error });
          }
        });
      } catch (error) { this.logger.warn("Memory completion record unavailable", { subscription_id: item.subscription_id, error: String(error) }); }
    }
  }

  /** 关闭时完成已经进行的状态提交，之后不再触发新投递。 */
  async dispose(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
