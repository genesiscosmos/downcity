/** 支付套餐、不可变权益快照及独立履约状态；不包含渠道凭据。 */
export interface PaymentCardPlan extends Record<string, unknown> {
  /** 服务端套餐标识。 */
  plan_id: string;
  /** 展示名称。 */
  name: string;
  /** 结算币种小写 ISO 代码。 */
  currency: string;
  /** 最小货币单位金额，正安全整数。 */
  amount_minor: number;
  /** 发卡额度，正安全整数。 */
  credits: number;
  /** 从稳定履约起点开始的有效秒数。 */
  duration_seconds: number;
  /** 可购买标志，删除以停售实现。 */
  enabled: number;
  /** 乐观并发版本。 */
  version: number;
  /** 创建时间。 */
  created_at: string;
  /** 最近修改时间。 */
  updated_at: string;
}
export interface PaymentEntitlement extends Record<string, unknown> {
  /** 充值进入 Primary，套餐发独立 Ephemeral。 */
  kind: "topup" | "card";
  /** 下单时冻结的完整套餐，充值为 null。 */
  plan: PaymentCardPlan | null;
}
export interface PaymentFulfillment extends Record<string, unknown> {
  /** 与支付记录一对一。 */
  payment_id: string;
  /** 订单用户，不从 webhook 的用户信息接受覆盖。 */
  user_id: string;
  /** pending、processing、fulfilled、failed，与 paid 分离。 */
  status: string;
  /** 首次开始履约的稳定时间，重试不延长有效期。 */
  started_at: string;
  /** 首次发卡截止时间，充值为空。 */
  expires_at: string;
  /** 并发租约的唯一标识。 */
  lease: string;
  /** 租约截止 Unix 毫秒。 */
  lease_until: number;
  /** 成功完成时间。 */
  fulfilled_at: string;
}
export interface PaymentWalletTable<T> {
  /** 按等值条件查询。 */
  select(where?: Partial<T>): Promise<T[]>;
  /** 插入唯一记录。 */
  insert(row: T): Promise<unknown>;
  /** 使用旧版本或租约执行条件更新。 */
  update(input: { /** 条件。 */ where: Partial<T>; /** 新值。 */ values: Partial<T> }): Promise<number>;
}
export interface PaymentFulfillmentContext {
  /** 本次订单冻结权益。 */
  entitlement: PaymentEntitlement;
  /** 稳定履约起点。 */
  started_at: string;
  /** 稳定发卡到期时间。 */
  expires_at: string;
}
