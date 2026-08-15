/** Desktop 账户用量视图模型。 */

import type { DesktopUsageDay } from "@common/types/DesktopApi";

/** 用量统计周期。 */
export type UsagePeriod = "day" | "week" | "month";

/** 当前周期的汇总用量。 */
export interface UsagePeriodSummary {
  /** 周期内消费的 Credits。 */
  credits_used: number;
  /** 周期内使用的 Token 总量。 */
  total_tokens: number;
}

/** 趋势图中的一个聚合数据点。 */
export interface UsageTrendPoint {
  /** 数据点的稳定标识。 */
  key: string;
  /** 数据点覆盖范围的起始日期。 */
  start_date: string;
  /** 数据点覆盖范围的结束日期。 */
  end_date: string;
  /** 数据点覆盖范围内消费的 Credits。 */
  credits_used: number;
}

/** 活动热力图中的一个自然日。 */
export interface UsageHeatmapDay extends DesktopUsageDay {
  /** 相对当前展示范围最大值的活动等级。 */
  level: 0 | 1 | 2 | 3 | 4;
  /** 当前日期是否属于真实展示范围。 */
  in_range: boolean;
}

/** 活动热力图中的一个自然周。 */
export interface UsageHeatmapWeek {
  /** 周起始日期，用作稳定标识。 */
  key: string;
  /** 从周一到周日排列的七个自然日。 */
  days: UsageHeatmapDay[];
}

/** 活动热力图顶部的月份标签。 */
export interface UsageHeatmapMonthLabel {
  /** 年月稳定标识。 */
  key: string;
  /** 用于本地化展示的代表日期。 */
  date: string;
  /** 标签所在的周列索引。 */
  column: number;
}

/** 活动热力图的完整网格数据。 */
export interface UsageHeatmap {
  /** 按自然周排列的热力图列。 */
  weeks: UsageHeatmapWeek[];
  /** 跨月份时显示的顶部标签。 */
  months: UsageHeatmapMonthLabel[];
}
