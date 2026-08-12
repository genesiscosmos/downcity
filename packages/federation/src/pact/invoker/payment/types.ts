/**
 * Payment 调用器对外类型。
 *
 * 关键说明（中文）
 * - `payment` 是统一支付入口，负责告诉前端“当前有哪些支付方式”
 * - 具体执行动作统一落到 `payment` service 的 `checkout/create`
 * - client 侧通过 typed invoker 屏蔽 service / action 的拼接细节
 */

/**
 * 支付方式模式。
 */
export type UserPaymentMethodType = "checkout";

/**
 * 支付方式不可用原因。
 */
export type UserPaymentMethodReason = "not_configured" | "not_supported";

/**
 * 单个支付方式定义。
 */
export interface UserPaymentMethod {
  /**
   * 支付方式唯一标识。
   *
   * 例如：`stripe`
   */
  id: string;

  /**
   * 当前支付方式模式。
   *
   * 当前版本统一为 `checkout`，表示需要先创建支付会话，再跳转到第三方支付页。
   */
  type: UserPaymentMethodType;

  /**
   * 当前 Federation 是否已真正开放该支付方式。
   */
  enabled: boolean;

  /**
   * 展示给终端用户的支付方式名称。
   */
  label: string;

  /**
   * 发起支付时应调用的 service id。
   *
   * 当前统一为 `payment`。
   */
  service: string;

  /**
   * 发起支付时应调用的 action id。
   *
   * 当前统一为 `checkout/create`。
   */
  action: string;

  /**
   * 当前支付方式是否要求用户先处于登录态。
   */
  requires_user: boolean;

  /**
   * 当前支付方式默认结算币种。
   */
  currency: string;

  /**
   * 当前支付方式未启用时的原因。
   */
  reason?: UserPaymentMethodReason;
}
