/**
 * Downcity 官方 Payment 统一服务。
 *
 * 关键点（中文）
 * - payment 是唯一支付服务，Stripe / Creem / Dodo / Waffo 都只是 provider。
 * - 统一负责 checkout、本地支付订单、webhook 幂等与状态同步。
 * - 所有 provider 共用 `/v1/payment/*` 路由和统一 payments/events 表。
 */

import { InstallableService, type EnvRequirement, type ServiceInstallContext } from "@downcity/city";
import { paymentEvents, paymentPayments } from "./schema.js";
import { mergeEnvRequirements, normalizeProviders } from "./helpers.js";
import { installPaymentRoutes } from "./routes.js";
import type { PaymentProvider, PaymentRecord, PaymentServiceOptions } from "./types.js";

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
  readonly schema = {
    payments: paymentPayments,
    events: paymentEvents,
  };

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
    installPaymentRoutes(this, ctx);
  }

  /** 通知接入方处理已确认支付订单。 */
  on_paid(record: PaymentRecord): Promise<void> {
    return this.options.on_paid(record);
  }

  /**
   * 获取已挂载的 provider 列表。
   */
  getProviders(): PaymentProvider[] {
    return this.providers;
  }
}
