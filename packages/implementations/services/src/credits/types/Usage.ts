/**
 * Credits 用户每日消费读取契约。
 *
 * Credits 用量只来自已入账 Charge；Topup、Pending 与回滚记录不属于消费事实。
 */

import type { AdminUsageQuery, UserDailyUsageQuery } from "@downcity/federation";

/** Credits 每日消费 Bucket。 */
export interface CreditsDailyUsageBucket {
  /** 当地自然日，格式为 YYYY-MM-DD。 */
  date: string;
  /** 当天已入账 Charge 的 Credits 总量。 */
  used: number;
  /** 当天已入账 Charge 数量。 */
  charge_count: number;
}

/** Credits 每日消费聚合结果。 */
export interface CreditsDailyUsageResult {
  /** 第一笔已入账 Charge 在查询时区中的日期。 */
  data_available_from: string | null;
  /** 按当地日期升序排列的稀疏 Bucket。 */
  days: CreditsDailyUsageBucket[];
}

/** Admin 视角下单个用户的 Credits 消费聚合。 */
export interface AdminCreditsUsageUserBucket {
  /** Federation 内全局用户 ID。 */
  user_id: string;
  /** 查询范围内已入账 Charge 的 Credits 总量。 */
  credits_used: number;
  /** 查询范围内已入账 Charge 数量。 */
  charge_count: number;
}

/** Admin 跨用户 Credits 消费聚合结果。 */
export interface AdminCreditsUsageResult {
  /** 按用户聚合的 Credits 消费。 */
  users: AdminCreditsUsageUserBucket[];
  /** 按当地日期聚合的 Credits 消费。 */
  days: CreditsDailyUsageBucket[];
}

/** UsageService 依赖的最小 Credits 只读接口。 */
export interface CreditsUsageReader {
  /** 按用户、当地日期范围与 IANA 时区聚合已入账消费。 */
  aggregate_user_daily_charges(input: UserDailyUsageQuery): Promise<CreditsDailyUsageResult>;
  /** 按日期范围聚合 Federation 全部用户的已入账 Credits 消费。 */
  aggregate_admin_charges(input: AdminUsageQuery): Promise<AdminCreditsUsageResult>;
}
