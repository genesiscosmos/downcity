/**
 * Credits 用户每日消费读取契约。
 *
 * Credits 用量只来自已入账 Charge；Topup、Pending 与回滚记录不属于消费事实。
 */

import type { UserDailyUsageQuery } from "@downcity/city";

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

/** UsageService 依赖的最小 Credits 只读接口。 */
export interface CreditsUsageReader {
  /** 按用户、当地日期范围与 IANA 时区聚合已入账消费。 */
  aggregate_user_daily_charges(input: UserDailyUsageQuery): Promise<CreditsDailyUsageResult>;
}
