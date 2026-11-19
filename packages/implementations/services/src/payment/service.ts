/**
 * Downcity 官方 Payment 统一服务。
 *
 * 关键点（中文）
 * - payment 是唯一支付服务，Stripe / Creem / Dodo / Waffo 都只是 provider。
 * - 统一负责 checkout、本地支付订单、webhook 幂等与状态同步。
 * - 所有 provider 共用 `/v1/payment/*` 路由和统一 payments/events 表。
 */

import { InstallableService, type EnvRequirement, type ServiceInstallContext, type ServiceAvailability } from "@downcity/federation";
import { payment_documentation } from "./documentation.js";
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
    ]), {
      description: "Hosted payment checkout, verified webhook inbox, versioned card plans and idempotent fulfillment.",
      requirements: ["Prepared Payment schema", "Provider checkout credentials and webhook verification keys", "Host resolve_topup and idempotent on_paid callbacks", "Federation durable queue adapter and periodic recover_events invocation", "Public HTTP(S) callback/redirect origin"],
      availability: () => this.read_local_availability(),
    });
    this.options = options;
    this.providers = providers;
    this.instruction = [
      "统一支付服务。Stripe、Creem、Dodo、Waffo 都作为 provider 挂载。",
      "前端先读取 /methods，再通过 /checkout/create 创建对应 provider 的 checkout。",
      "所有 provider 共用 /webhook、/payments、/events 和统一 payment 表。",
      "支付确认后通过 on_paid 通知接入方幂等发放 Credits。",
      "配置：显式注册 Provider、resolve_topup 与 on_paid，准备数据库；Provider 密钥可由 options 或 env 提供；必须挂载持久队列并周期调用 recover_events。",
      "鉴权：methods 与 HTML 回跳页公开；checkout、本人订单与套餐读取要求 User Token；套餐写入、全部订单和事件管理要求 Admin Session。webhook 公开但必须验 Provider 签名。",
      "流程：methods/card-plans → checkout/create → 托管支付页 → 原文验签 webhook → 持久 inbox 与 Queue → 校验订单金额/币种/支付身份 → paid → 幂等履约。",
      "限制：客户端不能指定 Credits 或任意回跳 URL；幂等键必须对应同一支付意图；套餐保存/停售使用 version 乐观并发，订单保留原权益快照。",
      "paid 与 fulfilled 分开；用户通过 orders/me 查看，orders/retry 仅重试本人已确认 paid 的订单；回跳页面不能确认入账。",
    ].join("\n");
  }

  install(ctx: ServiceInstallContext): void {
    const documentation = Object.fromEntries(Object.entries(payment_documentation).map(([path, entry]) => [path, {
      ...entry,
      availability: () => this.read_action_availability(path),
    }]));
    this.wallet = new PaymentWallet(ctx, this.providers, (record, fulfillment) => this.options.on_paid(record, fulfillment), documentation);
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
    }, { auth: ["admin"], documentation: documentation["/events/process"] });
    this.action("events/recover", async () => await this.inbox.recover(), { auth: ["admin"], documentation: documentation["/events/recover"] });
    ctx.route({ method: "GET", path: "/events/inbox", documentation: documentation["/events/inbox"], auth: ["admin"], handler: async (context) =>
      context.jsonResponse({ items: await this.inbox.list() }) });
    ctx.route({ method: "POST", path: "/events/replay", documentation: documentation["/events/replay"], auth: ["admin"], handler: async (context) => {
      const input = await context.json();
      await this.inbox.replay(String(input.event_id ?? ""));
      return context.jsonResponse({ accepted: true });
    } });
    installPaymentRoutes(this, ctx, documentation);
  }

  /** 本地读取和管理不依赖 Provider；队列操作、履约和支付创建分别检查依赖。 */
  private read_action_availability(path: string): ServiceAvailability {
    if (!this.wallet || !this.inbox || !this._database || !this._authenticator) return { status: "unavailable", reason: "Payment database, wallet, inbox or authentication runtime is not installed." };
    if (["/methods", "/payments/me", "/payments", "/events", "/events/inbox", "/card-plans", "/card-plans/admin", "/card-plans/save", "/card-plans/delete", "/orders/me", "/redirect/success", "/redirect/cancel"].includes(path)) {
      return { status: "ready", reason: "Local Payment route and storage/authentication dependencies are installed; no payment provider is required." };
    }
    if (["/events/recover", "/events/replay"].includes(path)) return this._queue?.is_available()
      ? { status: "ready", reason: "Local payment inbox and durable queue adapter are installed." }
      : { status: "unavailable", reason: "A durable queue adapter is required for event dispatch." };
    if (path === "/orders/retry") return typeof this.options.on_paid === "function"
      ? { status: "ready", reason: "Local order storage and host fulfillment callback are installed; host callback dependencies are not probed." }
      : { status: "unavailable", reason: "Host payment fulfillment callback is missing." };
    return this.read_local_availability();
  }

  /** 检查本地安装、宿主回调、队列 adapter 与 Provider 同步配置，不调用支付网络。 */
  private read_local_availability(): ServiceAvailability {
    if (!this.wallet || !this.inbox || !this._database || !this._authenticator) return { status: "unavailable", reason: "Payment database, wallet, inbox or authentication runtime is not installed." };
    if (typeof this.options.resolve_topup !== "function" || typeof this.options.on_paid !== "function") return { status: "partial", reason: "Payment host pricing or fulfillment callback is missing." };
    if (!this._queue?.is_available()) return { status: "partial", reason: "Read routes are installed; checkout and event dispatch require a durable queue adapter." };
    try {
      const enabled_count = this.providers.filter(provider => provider.method({ env: key => this._env?.get(key) }).enabled).length;
      if (!enabled_count) return { status: "partial", reason: "Read routes are installed, but no payment provider is enabled by local configuration." };
      if (enabled_count < this.providers.length) return { status: "partial", reason: "Some payment providers are disabled by local configuration." };
      return { status: "ready", reason: "Local payment dependencies and provider configuration are available; provider connectivity and host recovery scheduling are not probed." };
    } catch {
      return { status: "unknown", reason: "Local payment provider configuration could not be evaluated." };
    }
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
