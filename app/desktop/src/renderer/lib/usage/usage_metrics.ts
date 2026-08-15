/** Desktop 账户用量的日期补齐、周期汇总与图表聚合规则。 */

import type { DesktopUsageDay } from "@common/types/DesktopApi";
import type {
  UsageHeatmap,
  UsageHeatmapDay,
  UsagePeriod,
  UsagePeriodSummary,
  UsageTrendPoint,
} from "@/types/DesktopUsage";

const empty_usage: Omit<DesktopUsageDay, "date"> = {
  credits_used: 0,
  total_tokens: 0,
  execution_count: 0,
  image_count: 0,
};

function parse_date_key(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** 将日期转换为不受时区偏移影响的 YYYY-MM-DD 键。 */
export function to_date_key(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/** 返回用户本地时区的当前日期键。 */
export function current_date_key(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function add_days(value: string, amount: number): string {
  const date = parse_date_key(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return to_date_key(date);
}

function add_months(value: string, amount: number): string {
  const date = parse_date_key(value);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return to_date_key(date);
}

function start_of_week(value: string): string {
  const date = parse_date_key(value);
  const weekday = date.getUTCDay();
  return add_days(value, -(weekday === 0 ? 6 : weekday - 1));
}

function end_of_month(value: string): string {
  const date = parse_date_key(value);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return to_date_key(date);
}

function period_start(period: UsagePeriod, end_date: string): string {
  if (period === "day") return end_date;
  if (period === "week") return start_of_week(end_date);
  return `${end_date.slice(0, 7)}-01`;
}

function day_map(days: DesktopUsageDay[]): Map<string, DesktopUsageDay> {
  return new Map(days.map((day) => [day.date, day]));
}

function day_at(days: Map<string, DesktopUsageDay>, date: string): DesktopUsageDay {
  return { date, ...(days.get(date) ?? empty_usage) };
}

/** 汇总当天、本自然周或本自然月的用量。 */
export function summarize_usage_period(
  days: DesktopUsageDay[],
  period: UsagePeriod,
  end_date = current_date_key(),
): UsagePeriodSummary {
  const start_date = period_start(period, end_date);
  return days.reduce<UsagePeriodSummary>((summary, day) => {
    if (day.date < start_date || day.date > end_date) return summary;
    summary.credits_used += day.credits_used;
    summary.total_tokens += day.total_tokens;
    return summary;
  }, { credits_used: 0, total_tokens: 0 });
}

/** 按日、自然周或自然月生成固定长度的 Credits 趋势。 */
export function build_usage_trend(
  days: DesktopUsageDay[],
  period: UsagePeriod,
  end_date = current_date_key(),
): UsageTrendPoint[] {
  const credits_in_range = (start_date: string, range_end: string) => days.reduce(
    (total, day) => day.date >= start_date && day.date <= range_end ? total + day.credits_used : total,
    0,
  );

  if (period === "day") {
    const by_date = day_map(days);
    return Array.from({ length: 30 }, (_, index) => {
      const date = add_days(end_date, index - 29);
      return { key: date, start_date: date, end_date: date, credits_used: by_date.get(date)?.credits_used ?? 0 };
    });
  }

  if (period === "week") {
    const current_week = start_of_week(end_date);
    return Array.from({ length: 12 }, (_, index) => {
      const start_date = add_days(current_week, (index - 11) * 7);
      const range_end = add_days(start_date, 6);
      return { key: start_date, start_date, end_date: range_end, credits_used: credits_in_range(start_date, range_end) };
    });
  }

  const current_month = `${end_date.slice(0, 7)}-01`;
  return Array.from({ length: 12 }, (_, index) => {
    const start_date = add_months(current_month, index - 11);
    const range_end = end_of_month(start_date);
    return { key: start_date.slice(0, 7), start_date, end_date: range_end, credits_used: credits_in_range(start_date, range_end) };
  });
}

function heat_level(value: number, maximum: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || maximum <= 0) return 0;
  return Math.max(1, Math.min(4, Math.ceil((value / maximum) * 4))) as 1 | 2 | 3 | 4;
}

/** 构建按自然周排列并补齐边界日期的年度活动热力图。 */
export function build_usage_heatmap(
  days: DesktopUsageDay[],
  end_date = current_date_key(),
  lookback_days = 365,
): UsageHeatmap {
  const by_date = day_map(days);
  const range_start = add_days(end_date, -(lookback_days - 1));
  const grid_start = start_of_week(range_start);
  const grid_end = add_days(start_of_week(end_date), 6);
  const maximum = days.reduce((result, day) => (
    day.date >= range_start && day.date <= end_date ? Math.max(result, day.credits_used) : result
  ), 0);
  const weeks: UsageHeatmap["weeks"] = [];

  let week_start = grid_start;
  while (week_start <= grid_end) {
    const week_days: UsageHeatmapDay[] = Array.from({ length: 7 }, (_, index) => {
      const date = add_days(week_start, index);
      const day = day_at(by_date, date);
      const in_range = date >= range_start && date <= end_date;
      return { ...day, level: in_range ? heat_level(day.credits_used, maximum) : 0, in_range };
    });
    weeks.push({ key: week_start, days: week_days });
    week_start = add_days(week_start, 7);
  }

  const months: UsageHeatmap["months"] = [];
  let previous_month = "";
  weeks.forEach((week, column) => {
    const representative = week.days.find((day) => day.in_range && day.date.slice(0, 7) !== previous_month);
    if (!representative) return;
    previous_month = representative.date.slice(0, 7);
    months.push({ key: previous_month, date: representative.date, column });
  });
  return { weeks, months };
}

/** 汇总热力图真实展示范围内的 Credits。 */
export function sum_heatmap_credits(heatmap: UsageHeatmap): number {
  return heatmap.weeks.reduce((total, week) => total + week.days.reduce(
    (week_total, day) => week_total + (day.in_range ? day.credits_used : 0),
    0,
  ), 0);
}
