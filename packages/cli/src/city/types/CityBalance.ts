/**
 * City user 余额与充值类型。
 *
 * 关键点（中文）
 * - 这些类型只描述 City CLI 用户侧展示与调用结果。
 * - `credits` / `usd_cents` 的数值单位清晰表达在字段名中。
 * - 真实额度由 CreditsService 持有，支付订单由 PaymentService 持有。
 */

/**
 * 当前登录用户的余额账户摘要。
 */
export interface CityBalanceAccount extends Record<string, unknown> {
  /**
   * City 用户 ID。
   */
  user_id: string;

  /**
   * 当前可用余额，单位为 credits。
   */
  credits: number;

  /**
   * 当前余额换算后的 USD 数字。
   */
  usd?: number;

  /**
   * 适合直接展示给用户的余额文本。
   */
  display?: string;

  /**
   * 账户创建时间。
   */
  created_at: string;

  /**
   * 账户最近更新时间。
   */
  updated_at: string;
}

/**
 * 当前登录用户创建的充值单摘要。
 */
/**
 * 支付 checkout 创建结果。
 */
export interface CityCheckoutResult extends Record<string, unknown> {
  /**
   * 支付服务内部记录 ID。
   */
  payment_id?: string;

  /**
   * 第三方支付 checkout session ID。
   */
  stripe_checkout_session_id?: string;

  /**
   * 可直接打开的 checkout URL。
   */
  checkout_url?: string;

  /**
   * 当前支付状态。
   */
  status?: string;
}

/**
 * 当前登录用户充值流程结果。
 */
export interface CityRechargeResult {
  /** 支付成功后发放的 Credits。 */
  credits: number;

  /** 支付金额，单位为结算币种的最小货币单位。 */
  amount_minor: number;

  /**
   * 支付 checkout 创建结果。
   */
  checkout: CityCheckoutResult;

  /**
   * 使用的支付方式 ID。
   */
  method_id: string;

  /**
   * 是否成功打开浏览器。
   */
  opened: boolean;
}

/**
 * 当前登录用户充值输入。
 */
export interface CityRechargeInput {
  /**
   * 充值额度，单位为 credits。
   */
  credits: number;

  /**
   * 支付方式 ID。
   */
  method_id?: string;

  /**
   * 充值说明。
   */
  note?: string;

  /**
   * 外部引用 ID。
   */
  ref?: string;

  /**
   * 是否自动打开 checkout URL。
   */
  open_checkout?: boolean;
}
