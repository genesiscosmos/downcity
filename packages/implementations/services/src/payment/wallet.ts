/**
 * Payment 钱包领域：套餐由管理端版本化维护，订单冻结权益，履约使用独立幂等日志。
 * 用户查询只投影本人安全字段；重试只处理已确认 paid 的订单，不接受回跳状态发卡。
 */
import { httpError, type ServiceInstallContext } from "@downcity/federation";
import type { PaymentRecord, PaymentProvider } from "./types.js";
import type { PaymentCardPlan, PaymentEntitlement, PaymentFulfillment, PaymentFulfillmentContext, PaymentWalletTable } from "./types/Wallet.js";

export class PaymentWallet {
  private readonly plans: PaymentWalletTable<PaymentCardPlan>;
  private readonly fulfillments: PaymentWalletTable<PaymentFulfillment>;
  private readonly payments: PaymentWalletTable<PaymentRecord>;
  constructor(private readonly ctx: ServiceInstallContext, private readonly providers: PaymentProvider[], private readonly deliver: (record: PaymentRecord, fulfillment: PaymentFulfillmentContext) => Promise<void>) {
    this.plans = ctx.table<PaymentCardPlan>("card_plans");
    this.fulfillments = ctx.table<PaymentFulfillment>("fulfillments");
    this.payments = ctx.table<PaymentRecord>("payments");
  }
  /** 只从服务端套餐或已存在的同一订单读取权益。 */
  async resolve_plan(plan_id: string, current?: PaymentRecord): Promise<PaymentEntitlement> {
    if (current) {
      const entitlement = read_entitlement(current);
      if (entitlement.kind !== "card" || entitlement.plan?.plan_id !== plan_id) throw httpError(409, "payment intent differs");
      return entitlement;
    }
    const plan = (await this.plans.select({ plan_id, enabled: 1 }))[0];
    if (!plan) throw httpError(404, "card plan is not available");
    return { kind: "card", plan };
  }
  /** paid 与履约分别持久化；Credits 的 transaction key 承担最终幂等屏障。 */
  async fulfill(record: PaymentRecord): Promise<void> {
    if (record.status !== "paid") throw httpError(409, "payment is not paid");
    let current = (await this.fulfillments.select({ payment_id: record.payment_id }))[0];
    const entitlement = read_entitlement(record);
    if (!current) {
      const started_at = new Date().toISOString();
      current = { payment_id: record.payment_id, user_id: record.user_id, status: "pending", started_at,
        expires_at: entitlement.plan ? new Date(Date.parse(started_at) + entitlement.plan.duration_seconds * 1000).toISOString() : "",
        lease: "", lease_until: 0, fulfilled_at: "" };
      try { await this.fulfillments.insert(current); } catch (error) {
        const existing = (await this.fulfillments.select({ payment_id: record.payment_id }))[0];
        if (!existing) throw error; current = existing;
      }
    }
    if (current.status === "fulfilled") return;
    if (current.status === "processing" && current.lease_until > Date.now()) throw httpError(409, "fulfillment in progress");
    const lease = crypto.randomUUID();
    const claimed = await this.fulfillments.update({ where: { payment_id: current.payment_id, status: current.status, lease: current.lease }, values: { status: "processing", lease, lease_until: Date.now() + 300000 } });
    if (!claimed) throw httpError(409, "fulfillment in progress");
    try {
      await this.deliver(record, { entitlement, started_at: current.started_at, expires_at: current.expires_at });
      const finished = await this.fulfillments.update({ where: { payment_id: current.payment_id, lease, status: "processing" }, values: { status: "fulfilled", fulfilled_at: new Date().toISOString(), lease_until: 0 } });
      if (!finished) throw httpError(409, "fulfillment lease lost");
    } catch (error) {
      await this.fulfillments.update({ where: { payment_id: current.payment_id, lease }, values: { status: "failed", lease_until: 0 } });
      throw error;
    }
  }
  install(): void {
    const ctx = this.ctx;
    ctx.route({ method: "GET", path: "/card-plans", auth: ["user"], handler: async c => c.jsonResponse({ items: await this.plans.select({ enabled: 1 }) }) });
    ctx.route({ method: "GET", path: "/card-plans/admin", auth: ["admin"], handler: async c => c.jsonResponse({ items: await this.plans.select() }) });
    ctx.route({ method: "POST", path: "/card-plans/save", auth: ["admin"], handler: async c => {
      const body = await c.json<Record<string, unknown>>();
      const plan_id = text(body.plan_id, "plan_id");
      const existing = (await this.plans.select({ plan_id }))[0];
      const version = body.version;
      if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) throw httpError(422, "invalid plan version");
      if (version !== (existing?.version ?? 0)) throw httpError(409, "plan version conflict");
      const now = new Date().toISOString();
      const currency = text(body.currency, "currency").toLowerCase();
      if (!/^[a-z]{3}$/.test(currency)) throw httpError(422, "invalid currency");
      const plan: PaymentCardPlan = { plan_id, name: text(body.name, "name"), currency,
        amount_minor: positive(body.amount_minor), credits: positive(body.credits), duration_seconds: positive(body.duration_seconds),
        enabled: body.enabled === true || body.enabled === 1 ? 1 : 0, version: version + 1, created_at: existing?.created_at || now, updated_at: now };
      if (!Number.isFinite(new Date(Date.now() + plan.duration_seconds * 1000).getTime())) throw httpError(422, "invalid plan duration");
      if (existing) {
        const changed = await this.plans.update({ where: { plan_id, version }, values: plan });
        if (!changed) throw httpError(409, "plan version conflict");
      } else { try { await this.plans.insert(plan); } catch { throw httpError(409, "plan already exists"); } }
      return c.jsonResponse(plan);
    } });
    // 删除采用停售；售出的订单引用不可被删除或覆盖。
    ctx.route({ method: "POST", path: "/card-plans/delete", auth: ["admin"], handler: async c => {
      const body = await c.json<Record<string, unknown>>();
      const plan_id = text(body.plan_id, "plan_id"), version = body.version;
      if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) throw httpError(422, "invalid plan version");
      const changed = await this.plans.update({ where: { plan_id, version }, values: { enabled: 0, version: version + 1, updated_at: new Date().toISOString() } });
      if (!changed) throw httpError(409, "plan version conflict");
      return c.jsonResponse({ disabled: true });
    } });
    ctx.route({ method: "GET", path: "/orders/me", auth: ["user"], handler: async c => {
      const user_id = text(c.user?.user_id, "user_id");
      const payment_id = new URL(c.request.url).searchParams.get("payment_id");
      const rows = await this.payments.select({ user_id, ...(payment_id ? { payment_id } : {}) });
      if (payment_id && !rows.length) throw httpError(404, "order not found");
      const items = await Promise.all(rows.sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0,100).map(async row => {
        const fulfillment = (await this.fulfillments.select({ payment_id: row.payment_id }))[0];
        return { payment_id: row.payment_id, provider: row.provider, status: row.status, credits: row.credits, amount_minor: row.amount_minor, currency: row.currency, created_at: row.created_at,
          entitlement: read_entitlement(row), fulfillment_status: fulfillment?.status || "pending", started_at: fulfillment?.started_at || null, expires_at: fulfillment?.expires_at || null, fulfilled_at: fulfillment?.fulfilled_at || null };
      }));
      return c.jsonResponse({ items });
    } });
    ctx.route({ method: "POST", path: "/orders/retry", auth: ["user"], handler: async c => {
      const body = await c.json<Record<string, unknown>>();
      const record = (await this.payments.select({ payment_id: text(body.payment_id, "payment_id"), user_id: text(c.user?.user_id, "user_id") }))[0];
      if (!record) throw httpError(404, "order not found");
      await this.fulfill(record);
      return c.jsonResponse({ accepted: true });
    } });
  }
}
/** 只信任数据库保存的服务端权益字段，不接受 webhook 或客户端 metadata 覆盖。 */
export function read_entitlement(record: PaymentRecord): PaymentEntitlement {
  const data = JSON.parse(record.metadata_json || "{}");
  return data.wallet_entitlement || { kind: "topup", plan: null };
}
function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw httpError(422, `invalid ${name}`);
  return value.trim();
}
function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw httpError(422, "positive safe integer required");
  return value;
}
