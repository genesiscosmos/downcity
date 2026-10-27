/** 支付可信事件收件箱：规范化事件持久化后由队列和周期扫描恢复处理。 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const paymentInbox = sqliteTable("service_payment_inbox", {
  /** Provider 与事件 ID 组成的稳定唯一键。 */
  event_id: text("event_id").primaryKey(),
  /** 完成验签的 Provider ID。 */
  provider: text("provider").notNull(),
  /** 验签后规范化的不可变事件，不依赖旧 HTTP 签名重新验签。 */
  event_json: text("event_json").notNull(),
  /** pending / processing / applied / ignored / review。 */
  status: text("status").notNull(),
  /** 已领取的执行次数。 */
  attempts: integer("attempts").notNull(),
  /** 下次允许执行的 Unix 毫秒时间。 */
  next_attempt_at: integer("next_attempt_at").notNull(),
  /** 本次执行的随机租约 ID。 */
  lease: text("lease").notNull(),
  /** 租约截止 Unix 毫秒时间。 */
  lease_until: integer("lease_until").notNull(),
  /** 稳定错误分类，不保存 SDK 响应或凭据。 */
  last_error: text("last_error").notNull(),
  /** 首次可靠接收时间。 */
  created_at: text("created_at").notNull(),
  /** 最近状态推进时间。 */
  updated_at: text("updated_at").notNull(),
});

/** 支付收件箱记录，状态字段由处理器通过条件更新推进。 */
export interface PaymentInboxRecord extends Record<string, unknown> {
  /** Provider 与事件身份组成的唯一键。 */
  event_id: string;
  /** 验签 Provider ID。 */
  provider: string;
  /** 可重放的可信规范化事件。 */
  event_json: string;
  /** 当前处理状态。 */
  status: string;
  /** 处理尝试次数。 */
  attempts: number;
  /** 下次执行毫秒时间。 */
  next_attempt_at: number;
  /** 当前处理租约。 */
  lease: string;
  /** 租约到期毫秒时间。 */
  lease_until: number;
  /** 安全诊断分类。 */
  last_error: string;
  /** 创建 ISO 时间。 */
  created_at: string;
  /** 更新 ISO 时间。 */
  updated_at: string;
}
