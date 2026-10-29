/**
 * Downcity 官方 Payment 统一服务。
 *
 * 关键点（中文）
 * - payment 是唯一支付服务，Stripe / Creem / Dodo / Waffo 都只是 provider。
 * - 统一负责 checkout、本地支付订单、webhook 幂等与状态同步。
 * - 所有 provider 共用 `/v1/payment/*` 路由和统一 payments/events 表。
 */

import { InstallableService, type EnvRequirement, type ServiceInstallContext } from "@downcity/federation";
import { payment_database_schemas } from "./database-schemas.js";
import { mergeEnvRequirements, normalizeProviders } from "./helpers.js";
import { installPaymentRoutes, syncPaymentEvent } from "./routes.js";
import { PaymentInbox } from "./PaymentInbox.js";
import { PaymentWallet } from "./wallet.js";
import type { PaymentEntitlement } from "./types/Wallet.js";
import type {
  PaymentProvider,
  PaymentEventRecord,
  PaymentRecord,
  PaymentServiceOptions,
  PaymentTopupResolution,
  PaymentTopupResolutionInput,
} from "./types.js";

/**
 * Payment 服务自身 env。
 */
const paymentEnv: EnvRequirement[] = [
  {
    key: "DOWNCITY_CITY_BASE_URL",
    description: "City 对外访问地址；用于自动生成统一 payment 结果页地址",
    required: false,
  },
];

/**
 * 统一 Payment 服务。
 */
export class PaymentService extends InstallableService {
  readonly id = "payment";
  readonly name = "Payment";
  readonly version = "0.2.0";
  readonly database_schemas = payment_database_schemas;

  private wallet?: PaymentWallet;
  /** 数据库支撑的事件执行器，由定期恢复和 Queue 共同唤醒。 */
  inbox!: PaymentInbox;
  private readonly options: PaymentServiceOptions;
  private readonly providers: PaymentProvider[];

  constructor(options: PaymentServiceOptions) {
    const providers = normalizeProviders(options.providers);
    super(mergeEnvRequirements([
      ...paymentEnv,
      ...providers.flatMap((provider) => provider.env),
    ]));
    this.options = options;
    this.providers = providers;
    this.instruction = [
      "统一支付服务。Stripe、Creem、Dodo、Waffo 都作为 provider 挂载。",
      "前端先读取 /methods，再通过 /checkout/create 创建对应 provider 的 checkout。",
      "所有 provider 共用 /webhook、/payments、/events 和统一 payment 表。",
      "支付确认后通过 on_paid 通知接入方幂等发放 Credits。",
    ].join("\n");
  }

  install(ctx: ServiceInstallContext): void {
    this.wallet = new PaymentWallet(ctx, this.providers, (record, fulfillment) => this.options.on_paid(record, fulfillment));
    this.wallet.install();
    const events = ctx.table<PaymentEventRecord>("events");
    this.inbox = new PaymentInbox(ctx.table("inbox"), {
      send: async (message) => {
        if (!this._queue) throw new Error("payment queue is not installed");
        await this._queue.send(message);
      },
    }, async (provider_id, event) => {
      const provider = this.providers.find((item) => item.id === provider_id);
      if (!provider) throw new Error("payment provider unavailable");
      const status = await syncPaymentEvent({ provider, event, payments: ctx.table<PaymentRecord>("payments"), service: this });
      await events.update({ where: { event_id: `${provider_id}:${event.event_id}` },
        values: { sync_status: status as PaymentEventRecord["sync_status"], sync_error: "" } });
      return status;
    }, ctx.database);
    this.hook.before(async (context) => {
      if (context.action?.id === "checkout/create") {
        if (!this._queue) throw new Error("payment queue is not installed");
        this._queue.require_available();
      }
    });
    // 直接 Action 保留抛错语义，Queue 不会把处理失败的 Response 当成已完成。
    this.action("events/process", async (context) => {
      await this.inbox.process(String(context.input.event_id ?? ""));
      return { processed: true };
    }, { auth: ["admin"] });
    this.action("events/recover", async () => await this.inbox.recover(), { auth: ["admin"] });
    ctx.route({ method: "GET", path: "/events/inbox", auth: ["admin"], handler: async (context) =>
      context.jsonResponse({ items: await this.inbox.list() }) });
    ctx.route({ method: "POST", path: "/events/replay", auth: ["admin"], handler: async (context) => {
      const input = await context.json();
      await this.inbox.replay(String(input.event_id ?? ""));
      return context.jsonResponse({ accepted: true });
    } });
    installPaymentRoutes(this, ctx);
  }

  /** 部署阶段建立恢复索引，使周期扫描只读取待执行状态。 */
  protected override async on_prepare_database(): Promise<void> {
    if (!this._database) throw new Error("payment database is not installed");
    await this._database.atomic([
      { sql: "CREATE INDEX IF NOT EXISTS payment_inbox_pending_idx ON service_payment_inbox (status, next_attempt_at)", params: [] },
      { sql: "CREATE INDEX IF NOT EXISTS payment_inbox_lease_idx ON service_payment_inbox (status, lease_until)", params: [] },
    ]);
  }

  /** 宿主必须周期调用；消息丢失和执行中断不依赖支付平台再次投递。 */
  async recover_events(): Promise<{ scheduled: number }> {
    return await this.inbox.recover();
  }

  /** 通知接入方处理已确认支付订单。 */
  on_paid(record: PaymentRecord): Promise<void> {
    if (!this.wallet) throw new Error("payment is not installed");
    return this.wallet.fulfill(record);
  }

  /** 只从服务端配置读取卡套餐，已有订单始终沿用权益快照。 */
  async resolve_plan(plan_id: string, current?: PaymentRecord): Promise<PaymentEntitlement> {
    if (!this.wallet) throw new Error("payment is not installed");
    return this.wallet.resolve_plan(plan_id, current);
  }

  /** 公布宿主已配置的充值规则，不在网站根据主机名推测。 */
  get_topup_policy(): PaymentServiceOptions["topup_policy"] | null {
    return this.options.topup_policy ? { ...this.options.topup_policy } : null;
  }

  /** 使用 Federation 服务端策略把自由充值金额结算为 Credits。 */
  async resolve_topup(input: PaymentTopupResolutionInput): Promise<PaymentTopupResolution> {
    return await this.options.resolve_topup(input);
  }

  /**
   * 获取已挂载的 provider 列表。
   */
  getProviders(): PaymentProvider[] {
    return this.providers;
  }
}
