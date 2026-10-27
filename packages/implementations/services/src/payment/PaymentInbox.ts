/**
 * 可信支付事件执行器。数据库记录是恢复事实源，Queue 仅唤醒；周期扫描接管丢失消息和过期租约。
 * 永久金额校验失败进入 review，临时故障指数退避。所有重放仍经过同一订单校验和幂等发放。
 */
import { httpError, type FederationTableApi, type ServiceDatabaseContext } from "@downcity/federation";
import type { PaymentProviderWebhookEvent } from "./types.js";
import type { PaymentInboxRecord } from "./inbox-schema.js";

/** 支付后台调度所需最小接口。 */
export interface PaymentInboxQueue {
  /** 将事件处理 action 持久化到已装配队列。 */
  send(message: {
    /** 目标服务稳定 ID。 */
    service: string;
    /** 要执行的后台 action。 */
    action: string;
    /** 事件身份输入，不携带支付密钥。 */
    input: Record<string, unknown>;
    /** 延迟唤醒毫秒数。 */
    delay_ms?: number;
  }): Promise<void>;
}

/** 持久化接收与可重入处理，不持有 HTTP 请求或签名密钥。 */
export class PaymentInbox {
  constructor(
    private readonly table: FederationTableApi<PaymentInboxRecord>,
    private readonly queue: PaymentInboxQueue,
    private readonly synchronize: (provider: string, event: PaymentProviderWebhookEvent) => Promise<string>,
    private readonly database: ServiceDatabaseContext,
  ) {}

  /** 只调用于验签完成后；同一事件只保存第一次收到的可信事实。 */
  async accept(provider: string, event: PaymentProviderWebhookEvent): Promise<string> {
    const event_id = `${provider}:${event.event_id}`;
    const now = new Date().toISOString();
    await this.table.insert_if_absent({ event_id, provider, event_json: JSON.stringify(event), status: "pending",
      attempts: 0, next_attempt_at: 0, lease: "", lease_until: 0, last_error: "", created_at: now, updated_at: now });
    const row = await this.require_event(event_id);
    if (["applied", "ignored", "review"].includes(row.status)) return row.status;
    // 入队失败向 HTTP 返回错误；记录仍保留，由后续投递或周期扫描恢复。
    await this.enqueue(event_id);
    return "pending";
  }

  /** 单事件 CAS 租约；队列调用失败会抛错，不能被误认为完成。 */
  async process(event_id: string): Promise<void> {
    const current = await this.require_event(event_id);
    if (["applied", "ignored", "review"].includes(current.status)) return;
    const now = Date.now();
    if (current.status === "processing" && current.lease_until > now) return;
    if (current.next_attempt_at > now) return;
    const lease = crypto.randomUUID();
    const changed = await this.table.update({
      where: { event_id, status: current.status, lease: current.lease },
      values: { status: "processing", lease, lease_until: now + 300_000,
        attempts: current.attempts + 1, updated_at: new Date().toISOString() },
    });
    if (!changed) return;
    try {
      const status = await this.synchronize(current.provider, JSON.parse(current.event_json) as PaymentProviderWebhookEvent);
      if (status !== "applied" && status !== "ignored") throw new Error("payment_order_not_ready");
      const finished = await this.table.update({ where: { event_id, lease, status: "processing" },
        values: { status, lease_until: 0, last_error: "", updated_at: new Date().toISOString() } });
      if (!finished) throw new Error("payment_event_lease_lost");
    } catch (error) {
      const status_code = (error as { statusCode?: number }).statusCode;
      const needs_review = [400, 403, 404, 422].includes(status_code ?? 0);
      const exhausted = current.attempts + 1 >= 20;
      const delay_ms = Math.min(3_600_000, 15_000 * 2 ** Math.min(current.attempts, 8));
      const status = needs_review || exhausted ? "review" : "pending";
      const updated = await this.table.update({ where: { event_id, lease, status: "processing" }, values: {
        status, lease_until: 0, next_attempt_at: Date.now() + delay_ms,
        last_error: needs_review ? "payment_validation_failed" : exhausted ? "payment_retry_exhausted" : "payment_processing_failed",
        updated_at: new Date().toISOString(),
      } });
      if (updated && status === "pending") await this.enqueue(event_id, delay_ms).catch(() => undefined);
      throw error;
    }
  }

  /** 周期扫描负责即使不存在任何后续 HTTP 或 Queue 投递也能恢复的执行保证。 */
  async recover(): Promise<{ scheduled: number }> {
    const now = Date.now();
    const result = await this.database.query({
      sql: "SELECT event_id FROM service_payment_inbox WHERE (status = 'pending' AND next_attempt_at <= ?) OR (status = 'processing' AND lease_until <= ?) ORDER BY next_attempt_at LIMIT 100",
      params: [now, now],
    });
    const rows = result.rows as Array<{ /** 要重新唤醒的已持久化事件。 */ event_id: string }>;
    for (const row of rows) await this.enqueue(row.event_id);
    return { scheduled: rows.length };
  }

  /** 管理员显式重放；校验不匹配仍会再次被阻止，不直接发放权益。 */
  async replay(event_id: string): Promise<void> {
    const row = await this.require_event(event_id);
    if (row.status === "processing" && row.lease_until > Date.now()) throw httpError(409, "payment event is processing");
    if (["applied", "ignored"].includes(row.status)) return;
    const changed = await this.table.update({ where: { event_id, status: row.status, lease: row.lease },
      values: { status: "pending", attempts: 0, next_attempt_at: 0, lease_until: 0, updated_at: new Date().toISOString() } });
    if (!changed) throw httpError(409, "payment event changed; retry");
    await this.enqueue(event_id);
  }

  /** 供管理员诊断，规范化原始 payload 不返回给普通用户。 */
  async list(): Promise<PaymentInboxRecord[]> {
    const result = await this.database.query({ sql: "SELECT * FROM service_payment_inbox ORDER BY created_at DESC LIMIT 100", params: [] });
    return result.rows as PaymentInboxRecord[];
  }

  private async require_event(event_id: string): Promise<PaymentInboxRecord> {
    const row = (await this.table.select({ event_id }))[0];
    if (!row) throw httpError(404, "payment event not found");
    return row;
  }

  private async enqueue(event_id: string, delay_ms = 0): Promise<void> {
    await this.queue.send({ service: "payment", action: "events/process", input: { event_id }, delay_ms });
  }
}
