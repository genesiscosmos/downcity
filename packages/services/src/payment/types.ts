/**
 * Payment 统一服务类型定义。
 *
 * 关键说明（中文）
 * - `payment` 是唯一对外服务，Stripe / Creem / Dodo / Waffo 都是 provider。
 * - provider 只负责创建 checkout、解析 webhook 和声明自身配置。
 * - 支付记录与 webhook 事件由 PaymentService 负责，Credits 入账通过 on_paid 边界交给接入方。
 */

import type { EnvRequirement } from "@downcity/city";

/**
 * 支付方式展示模式。
 */
export type PaymentMethodType = "checkout";

/**
 * 支付方式不可用原因。
 */
export type PaymentMethodReason = "not_configured" | "not_supported";

/**
 * 统一支付状态。
 */
export type PaymentStatus = "pending" | "paid" | "expired" | "failed" | "canceled";

/**
 * 统一 webhook 同步状态。
 */
export type PaymentEventSyncStatus =
  | "pending"
  | "processing"
  | "applied"
  | "ignored"
  | "failed";

/** Provider 创建 Checkout 时读取的支付订单快照。 */
export interface PaymentOrderSnapshot extends Record<string, unknown> {
  /** PaymentService 内部支付订单 ID。 */
  payment_id: string;
  /** 支付订单所属用户 ID。 */
  user_id: string;
  /** 支付成功后应发放的额度。 */
  credits: number;
  /** 真实支付金额，单位为结算币种的最小货币单位。 */
  amount_minor: number;
  /** 结算币种。 */
  currency: string;
  /** 订单说明。 */
  note: string;
}

/**
 * 单个支付方式返回项。
 */
export interface PaymentMethodItem {
  /** 支付方式唯一标识，例如 `stripe`。 */
  id: string;
  /** 支付方式模式。 */
  type: PaymentMethodType;
  /** 当前 City 是否实际开放该支付方式。 */
  enabled: boolean;
  /** 展示给前端的支付方式名称。 */
  label: string;
  /** 发起支付时应调用的 service id，统一为 `payment`。 */
  service: string;
  /** 发起支付时应调用的 action id，统一为 `checkout/create`。 */
  action: string;
  /** 是否要求用户先登录再发起支付。 */
  requires_user: boolean;
  /** 当前默认结算币种。 */
  currency: string;
  /** 未启用原因。 */
  reason?: PaymentMethodReason;
}

/**
 * provider 解析 method 时可用的上下文。
 */
export interface PaymentProviderContext {
  /** 读取 City runtime env。 */
  env(key: string): string | undefined;
}

/**
 * provider 创建 checkout 的输入。
 */
export interface PaymentProviderCheckoutInput {
  /** 服务内部 payment ID。 */
  payment_id: string;
  /** 支付订单快照。 */
  payment: PaymentOrderSnapshot;
  /** 当前请求。 */
  request: Request;
  /** City runtime env 上下文。 */
  ctx: PaymentProviderContext;
  /** 支付成功跳转地址。 */
  success_url: string;
  /** 支付取消跳转地址。 */
  cancel_url: string;
}

/**
 * provider 创建 checkout 的结果。
 */
export interface PaymentProviderCheckoutResult {
  /** provider checkout/session ID。 */
  provider_session_id: string;
  /** provider payment ID。 */
  provider_payment_id?: string;
  /** provider order ID。 */
  provider_order_id?: string;
  /** 第三方 checkout 托管页 URL。 */
  checkout_url: string;
  /** 写入 payment metadata_json 的 provider 扩展字段。 */
  metadata?: Record<string, unknown>;
}

/**
 * provider 解析 webhook 的输入。
 */
export interface PaymentProviderWebhookInput {
  /** 原始请求 body。 */
  raw: string;
  /** 当前请求。 */
  request: Request;
  /** City runtime env 上下文。 */
  ctx: PaymentProviderContext;
}

/**
 * provider 解析后的 webhook 事件。
 */
export interface PaymentProviderWebhookEvent {
  /** provider webhook 事件 ID。 */
  event_id: string;
  /** provider webhook 事件类型。 */
  type: string;
  /** 原始事件对象。 */
  payload: Record<string, unknown>;
  /** 事件对应的支付状态；无法处理时使用 `ignored`。 */
  status: PaymentStatus | "ignored";
  /** 服务内部 payment ID。 */
  payment_id?: string;
  /** provider checkout/session ID。 */
  provider_session_id?: string;
  /** provider payment ID。 */
  provider_payment_id?: string;
  /** provider order ID。 */
  provider_order_id?: string;
  /** 入账流水外部引用。 */
  ref?: string;
  /** 入账 metadata。 */
  meta?: Record<string, unknown>;
}

/**
 * Payment provider 定义。
 */
export interface PaymentProvider {
  /** provider ID，例如 `stripe`。 */
  id: string;
  /** provider 展示名。 */
  label: string;
  /** provider 需要暴露给 env 管理的配置项。 */
  env: EnvRequirement[];
  /** 生成支付方式展示信息。 */
  method(ctx: PaymentProviderContext): PaymentMethodItem;
  /** 创建 checkout。 */
  createCheckout(input: PaymentProviderCheckoutInput): Promise<PaymentProviderCheckoutResult>;
  /** 解析并校验 webhook。 */
  parseWebhook(input: PaymentProviderWebhookInput): Promise<PaymentProviderWebhookEvent>;
}

/**
 * Payment 服务配置。
 */
export interface PaymentServiceOptions {
  /** 当前 City 启用的支付 provider。 */
  providers: PaymentProvider[];
  /** 支付订单首次确认 paid 后触发；接入方应使用 payment_id 幂等发放 Credits。 */
  on_paid(record: PaymentRecord): Promise<void>;
}

/**
 * 统一创建 Checkout 请求。
 */
export interface PaymentCreateCheckoutInput extends Record<string, unknown> {
  /** 支付方式 ID，例如 `stripe`、`dodo`。 */
  method_id?: string;
  /** `method_id` 的别名，方便服务端脚本直接调用。 */
  provider?: string;
  /** 支付成功后发放的正数 Credits。 */
  credits: number;
  /** 支付金额，单位为结算币种的最小货币单位。 */
  amount_minor: number;
  /** 客户端为本次支付意图提供的稳定幂等键。 */
  idempotency_key: string;
  /** 面向用户与审计的订单说明。 */
  note?: string;
  /** 结构化订单信息。 */
  metadata?: Record<string, unknown>;
}

/**
 * 统一 Checkout 创建结果。
 */
export interface PaymentCheckoutCreateResult extends Record<string, unknown> {
  /** 服务内部支付记录 ID。 */
  payment_id: string;
  /** provider ID。 */
  provider: string;
  /** provider checkout/session ID。 */
  provider_session_id: string;
  /** provider payment ID。 */
  provider_payment_id: string;
  /** provider order ID。 */
  provider_order_id: string;
  /** 可直接跳转的 Checkout URL。 */
  checkout_url: string;
  /** 当前支付状态。 */
  status: PaymentStatus;
}

/**
 * 统一支付记录。
 */
export interface PaymentRecord extends Record<string, unknown> {
  /** 服务内部支付记录 ID。 */
  payment_id: string;
  /** provider ID。 */
  provider: string;
  /** 充值目标用户 ID。 */
  user_id: string;
  /** 创建支付意图时使用的稳定幂等键。 */
  idempotency_key: string;
  /** provider checkout/session ID。 */
  provider_session_id: string;
  /** provider payment ID。 */
  provider_payment_id: string;
  /** provider order ID。 */
  provider_order_id: string;
  /** 本次充值额度，单位为 credits。 */
  credits: number;
  /** 真实支付金额，单位为最小货币单位，例如 USD cents。 */
  amount_minor: number;
  /** 结算币种。 */
  currency: string;
  /** 当前支付状态。 */
  status: PaymentStatus;
  /** 第三方 Checkout 托管页面 URL。 */
  checkout_url: string;
  /** 面向用户与审计的订单说明。 */
  note: string;
  /** 扩展字段 JSON 文本。 */
  metadata_json: string;
  /** 创建时间。 */
  created_at: string;
  /** 更新时间。 */
  updated_at: string;
}

/**
 * PaymentService 内部的 Checkout 创建租约结果。
 */
export interface PaymentCheckoutCreationClaim {
  /** 当前请求是否成功持有 Provider Checkout 创建租约。 */
  claimed: boolean;
  /** 当前记录是否已经包含可以直接返回的 Checkout 结果。 */
  ready: boolean;
  /** 租约对应的本地 payment 记录。 */
  record: PaymentRecord;
  /** 当前请求持有的租约 metadata JSON；完成或失败时用于 compare-and-set。 */
  lease_metadata_json: string;
}

/**
 * 统一 webhook 事件记录。
 */
export interface PaymentEventRecord extends Record<string, unknown> {
  /** provider webhook 事件 ID。 */
  event_id: string;
  /** provider ID。 */
  provider: string;
  /** webhook 事件类型。 */
  type: string;
  /** 原始事件 JSON 文本。 */
  payload_json: string;
  /** 当前同步状态。 */
  sync_status: PaymentEventSyncStatus;
  /** 同步失败摘要。 */
  sync_error: string;
  /** 记录创建时间。 */
  created_at: string;
}

/**
 * Stripe provider 配置。
 */
export interface StripePaymentProviderOptions {
  /** 显式注入的 Stripe Secret Key。 */
  secret_key?: string;
  /** Stripe webhook 签名密钥。 */
  webhook_secret?: string;
  /** 默认结算币种。 */
  currency?: string;
  /** Checkout 商品名。 */
  item_name?: string;
  /** Stripe API 基础地址。 */
  api_base_url?: string;
  /** 可选展示名称。 */
  label?: string;
}

/**
 * Creem provider 配置。
 */
export interface CreemPaymentProviderOptions {
  /** 显式注入的 Creem API Key。 */
  api_key?: string;
  /** 显式注入的 Creem product_id。 */
  product_id?: string;
  /** Creem webhook 签名密钥。 */
  webhook_secret?: string;
  /** 默认结算币种。 */
  currency?: string;
  /** Creem API 基础地址。 */
  api_base_url?: string;
  /** 可选展示名称。 */
  label?: string;
}

/**
 * Dodo Payments provider 配置。
 */
export interface DodoPaymentProviderOptions {
  /** 显式注入的 Dodo Payments API Key。 */
  api_key?: string;
  /** 显式注入的 Dodo product_id。 */
  product_id?: string;
  /** Dodo webhook signing key。 */
  webhook_key?: string;
  /** Dodo SDK 运行环境。 */
  environment?: "test_mode" | "live_mode";
  /** 默认结算币种。 */
  currency?: string;
  /** Dodo API 基础地址。 */
  api_base_url?: string;
  /** 可选展示名称。 */
  label?: string;
}

/**
 * Waffo Pancake provider 配置。
 */
export interface WaffoPaymentProviderOptions {
  /** 显式注入的 Waffo Merchant ID。 */
  merchant_id?: string;
  /** 显式注入的 Waffo private key。 */
  private_key?: string;
  /** 显式注入的 Waffo product_id。 */
  product_id?: string;
  /** webhook 验签 public key。 */
  webhook_public_key?: string;
  /** Waffo 运行环境。 */
  environment?: "test" | "prod";
  /** 默认结算币种。 */
  currency?: string;
  /** Waffo API 基础地址。 */
  api_base_url?: string;
  /** 可选展示名称。 */
  label?: string;
}
