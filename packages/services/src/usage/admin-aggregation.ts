/**
 * Usage Admin 聚合模块。
 *
 * AI Usage 与 Credits 仍由各自事实所有者提供；本模块只按 user_id 和当地日期
 * 合并只读结果，并统一计算 DAU、WAU、MAU 与用户 Usage。
 */

import type { AdminAIUsageResult } from "@downcity/city";
import type { AdminCreditsUsageResult } from "../credits/types/Usage.js";
import type {
  AdminUsageActivityMetrics,
  AdminUsageDay,
  AdminUsageOverviewResponse,
  AdminUsageRetentionResponse,
  AdminUsageUsersResponse,
  AdminUserUsageItem,
  UsageAccountRegistration,
} from "./types/Usage.js";

/** 构建 Admin Usage Overview。 */
export function build_admin_usage_overview(input: {
  /** 查询时区。 */
  timezone: string;
  /** 用户选择范围起始日期。 */
  from: string;
  /** 用户选择范围结束日期。 */
  to: string;
  /** 用户选择范围内 AI 聚合。 */
  ai: AdminAIUsageResult;
  /** 最近 30 天 AI 聚合，用于稳定计算 DAU/WAU/MAU。 */
  activity_ai: AdminAIUsageResult;
  /** 用户选择范围内 Credits 聚合。 */
  credits: AdminCreditsUsageResult;
}): AdminUsageOverviewResponse {
  const users = merge_admin_usage_users(input.ai, input.credits);
  return {
    timezone: input.timezone,
    from: input.from,
    to: input.to,
    activity: build_activity(input.activity_ai, input.ai.users.length, input.to),
    summary: users.reduce(add_user_usage, empty_admin_user_usage("__all__")),
    days: merge_admin_usage_days(input.ai, input.activity_ai, input.credits, input.from, input.to),
    models: input.ai.models,
    actions: input.ai.actions,
    hours: input.ai.hours,
    performance: input.ai.performance,
  };
}

/** 构建基于注册 Cohort 与真实 AI Usage 活跃日的留存分析。 */
export function build_admin_usage_retention(input: {
  /** 查询时区。 */
  timezone: string;
  /** 查询范围起始日期。 */
  from: string;
  /** 查询范围结束日期。 */
  to: string;
  /** Accounts 注册用户事实。 */
  accounts: UsageAccountRegistration[];
  /** 查询范围内 AI 活跃事实。 */
  ai: AdminAIUsageResult;
}): AdminUsageRetentionResponse {
  const active_dates = new Map(input.ai.users.map((user) => [user.user_id, new Set(user.active_dates)]));
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: input.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const cohort_users = new Map<string, UsageAccountRegistration[]>();
  for (const account of input.accounts) {
    const date = format_local_date(formatter, new Date(account.created_at));
    if (date < input.from || date > input.to) continue;
    const users = cohort_users.get(date) ?? [];
    users.push(account);
    cohort_users.set(date, users);
  }
  const offsets = [1, 3, 7, 14, 30] as const;
  const totals = new Map<number, { retained: number; eligible: number }>();
  const cohorts = [...cohort_users.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, users]) => {
      const rates = Object.fromEntries(offsets.map((offset) => {
        const observed_date = shift_date(date, offset);
        if (observed_date > input.to) return [`day_${offset}`, null];
        const retained = users.filter((user) => active_dates.get(user.user_id)?.has(observed_date)).length;
        const total = totals.get(offset) ?? { retained: 0, eligible: 0 };
        total.retained += retained;
        total.eligible += users.length;
        totals.set(offset, total);
        return [`day_${offset}`, users.length > 0 ? retained / users.length : null];
      }));
      return {
        date,
        new_user_count: users.length,
        rates: rates as unknown as AdminUsageRetentionResponse["cohorts"][number]["rates"],
      };
    });
  const average_rates = Object.fromEntries(offsets.map((offset) => {
    const total = totals.get(offset);
    return [`day_${offset}`, total && total.eligible > 0 ? total.retained / total.eligible : null];
  })) as unknown as AdminUsageRetentionResponse["average_rates"];
  return {
    timezone: input.timezone,
    from: input.from,
    to: input.to,
    total_registered_users: input.accounts.length,
    registration_days: cohorts.map(({ date, new_user_count }) => ({ date, new_user_count })),
    cohorts,
    average_rates,
  };
}

/** 构建 Admin 按用户 Usage 响应。 */
export function build_admin_usage_users(input: {
  /** 查询时区。 */
  timezone: string;
  /** 查询范围起始日期。 */
  from: string;
  /** 查询范围结束日期。 */
  to: string;
  /** AI 聚合。 */
  ai: AdminAIUsageResult;
  /** Credits 聚合。 */
  credits: AdminCreditsUsageResult;
}): AdminUsageUsersResponse {
  return {
    timezone: input.timezone,
    from: input.from,
    to: input.to,
    items: merge_admin_usage_users(input.ai, input.credits),
  };
}

function build_activity(ai: AdminAIUsageResult, range_active_users: number, to: string): AdminUsageActivityMetrics {
  const weekly_from = shift_date(to, -6);
  const monthly_from = shift_date(to, -29);
  const daily = new Set<string>();
  const weekly = new Set<string>();
  const monthly = new Set<string>();
  for (const user of ai.users) {
    for (const date of user.active_dates) {
      if (date === to) daily.add(user.user_id);
      if (date >= weekly_from && date <= to) weekly.add(user.user_id);
      if (date >= monthly_from && date <= to) monthly.add(user.user_id);
    }
  }
  return {
    range_active_users,
    daily_active_users: daily.size,
    weekly_active_users: weekly.size,
    monthly_active_users: monthly.size,
    daily_monthly_stickiness: monthly.size > 0 ? daily.size / monthly.size : null,
  };
}

function merge_admin_usage_users(ai: AdminAIUsageResult, credits: AdminCreditsUsageResult): AdminUserUsageItem[] {
  const items = new Map<string, AdminUserUsageItem>();
  for (const user of ai.users) {
    const { active_dates, ...public_user } = user;
    void active_dates;
    items.set(user.user_id, {
      ...empty_admin_user_usage(user.user_id),
      ...public_user,
      success_rate: user.execution_count > 0 ? user.succeeded_count / user.execution_count : null,
    });
  }
  for (const credit of credits.users) {
    const item = items.get(credit.user_id) ?? empty_admin_user_usage(credit.user_id);
    item.credits_used = credit.credits_used;
    item.charge_count = credit.charge_count;
    items.set(credit.user_id, item);
  }
  return [...items.values()].sort((left, right) =>
    right.total_tokens - left.total_tokens
    || right.credits_used - left.credits_used
    || right.execution_count - left.execution_count
    || left.user_id.localeCompare(right.user_id)
  );
}

function merge_admin_usage_days(
  ai: AdminAIUsageResult,
  activity_ai: AdminAIUsageResult,
  credits: AdminCreditsUsageResult,
  from: string,
  to: string,
): AdminUsageDay[] {
  const days = new Map<string, AdminUsageDay>();
  for (let date = from; date <= to; date = shift_date(date, 1)) {
    const daily = active_users_in_window(activity_ai, date, date);
    const monthly = active_users_in_window(activity_ai, shift_date(date, -29), date);
    days.set(date, {
      date,
      active_user_count: daily,
      weekly_active_user_count: active_users_in_window(activity_ai, shift_date(date, -6), date),
      monthly_active_user_count: monthly,
      daily_monthly_stickiness: monthly > 0 ? daily / monthly : null,
      execution_count: 0,
      total_tokens: 0,
      credits_used: 0,
      charge_count: 0,
      succeeded_count: 0,
      failed_count: 0,
      cancelled_count: 0,
      uncached_input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      metering_unavailable_count: 0,
      average_duration_ms: null,
      p95_duration_ms: null,
    });
  }
  for (const day of ai.days) {
    const target = days.get(day.date);
    if (!target) continue;
    Object.assign(target, {
      execution_count: day.execution_count,
      total_tokens: day.total_tokens,
      succeeded_count: day.succeeded_count,
      failed_count: day.failed_count,
      cancelled_count: day.cancelled_count,
      uncached_input_tokens: day.uncached_input_tokens,
      cached_input_tokens: day.cached_input_tokens,
      output_tokens: day.output_tokens,
      reasoning_tokens: day.reasoning_tokens,
      metering_unavailable_count: day.metering_unavailable_count,
      average_duration_ms: day.average_duration_ms,
      p95_duration_ms: day.p95_duration_ms,
    });
  }
  for (const credit of credits.days) {
    const day = days.get(credit.date) ?? {
      date: credit.date,
      active_user_count: 0,
      weekly_active_user_count: 0,
      monthly_active_user_count: 0,
      daily_monthly_stickiness: null,
      execution_count: 0,
      total_tokens: 0,
      credits_used: 0,
      charge_count: 0,
      succeeded_count: 0,
      failed_count: 0,
      cancelled_count: 0,
      uncached_input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      metering_unavailable_count: 0,
      average_duration_ms: null,
      p95_duration_ms: null,
    };
    day.credits_used = credit.used;
    day.charge_count = credit.charge_count;
    days.set(credit.date, day);
  }
  return [...days.values()].sort((left, right) => left.date.localeCompare(right.date));
}

/** 计算日期窗口内去重活跃用户数。 */
function active_users_in_window(ai: AdminAIUsageResult, from: string, to: string): number {
  return ai.users.filter((user) => user.active_dates.some((date) => date >= from && date <= to)).length;
}

function empty_admin_user_usage(user_id: string): AdminUserUsageItem {
  return {
    user_id,
    last_active_at: "",
    execution_count: 0,
    succeeded_count: 0,
    failed_count: 0,
    cancelled_count: 0,
    success_rate: null,
    metered_request_count: 0,
    uncached_input_tokens: 0,
    cached_input_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
    image_count: 0,
    video_seconds: 0,
    audio_seconds: 0,
    credits_used: 0,
    charge_count: 0,
    top_model_id: "",
    metering_unavailable_count: 0,
    average_duration_ms: null,
    p95_duration_ms: null,
  };
}

function add_user_usage(total: AdminUserUsageItem, user: AdminUserUsageItem): AdminUserUsageItem {
  const execution_count = total.execution_count + user.execution_count;
  const succeeded_count = total.succeeded_count + user.succeeded_count;
  return {
    ...total,
    last_active_at: user.last_active_at > total.last_active_at ? user.last_active_at : total.last_active_at,
    execution_count,
    succeeded_count,
    failed_count: total.failed_count + user.failed_count,
    cancelled_count: total.cancelled_count + user.cancelled_count,
    success_rate: execution_count > 0 ? succeeded_count / execution_count : null,
    metered_request_count: total.metered_request_count + user.metered_request_count,
    uncached_input_tokens: total.uncached_input_tokens + user.uncached_input_tokens,
    cached_input_tokens: total.cached_input_tokens + user.cached_input_tokens,
    input_tokens: total.input_tokens + user.input_tokens,
    output_tokens: total.output_tokens + user.output_tokens,
    reasoning_tokens: total.reasoning_tokens + user.reasoning_tokens,
    total_tokens: total.total_tokens + user.total_tokens,
    image_count: total.image_count + user.image_count,
    video_seconds: total.video_seconds + user.video_seconds,
    audio_seconds: total.audio_seconds + user.audio_seconds,
    credits_used: total.credits_used + user.credits_used,
    charge_count: total.charge_count + user.charge_count,
    metering_unavailable_count: total.metering_unavailable_count + user.metering_unavailable_count,
    average_duration_ms: weighted_average_duration(total, user),
    p95_duration_ms: null,
  };
}

/** 汇总层按有耗时的执行次数加权平均；P95 不可由聚合分位数反推。 */
function weighted_average_duration(total: AdminUserUsageItem, user: AdminUserUsageItem): number | null {
  const total_weight = total.average_duration_ms === null ? 0 : total.execution_count;
  const user_weight = user.average_duration_ms === null ? 0 : user.execution_count;
  const weight = total_weight + user_weight;
  if (weight === 0) return null;
  return Math.round(
    ((total.average_duration_ms ?? 0) * total_weight + (user.average_duration_ms ?? 0) * user_weight) / weight,
  );
}

function shift_date(date: string, offset_days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset_days);
  return value.toISOString().slice(0, 10);
}

/** 使用 Intl parts 生成稳定的 YYYY-MM-DD。 */
function format_local_date(formatter: Intl.DateTimeFormat, date: Date): string {
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("Usage retention local date is invalid");
  return `${year}-${month}-${day}`;
}
