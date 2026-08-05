/**
 * fed Admin Dashboard 指标计算模块。
 *
 * 关键说明（中文）
 * - 所有跨 service 业务指标都在 CLI 内计算。
 * - range 切换只依赖 raw data 重算，不重新请求网络。
 */

import type {
  dashboard_money_group,
  dashboard_range,
  dashboard_raw_data,
  dashboard_record,
  dashboard_snapshot,
  dashboard_window,
} from "@/federation/types/AdminDashboard.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 构建 Dashboard 指标快照。
 */
export function build_dashboard_snapshot(raw_data: dashboard_raw_data, range: dashboard_range): dashboard_snapshot {
  const window = create_window(range);
  const paid_payments = raw_data.payment_payments.filter((item) => read_string(item.status) === "paid");
  const paid_payments_with_amount = paid_payments.filter((item) => has_amount_minor(item));
  const range_paid_payments = paid_payments.filter((item) => in_range(item, window));
  const range_paid_payments_with_amount = range_paid_payments.filter((item) => has_amount_minor(item));
  const usage_activity = read_record(raw_data.usage_overview.activity);
  const usage_summary = read_record(raw_data.usage_overview.summary);
  const first_paid_times = read_first_paid_times(paid_payments);
  const active_in_range = read_number(usage_activity.range_active_users);
  const paying_users_range = count_unique(range_paid_payments.map((item) => read_string(item.user_id)));
  const usage_event_count = read_number(usage_summary.execution_count);
  const error_events_range = read_number(usage_summary.failed_count);
  const usage_error_rate_range = safe_rate(error_events_range, usage_event_count);

  const users = {
    total_registered: raw_data.accounts_users.length,
    new_today: count_records_since(raw_data.accounts_users, window.today_start),
    new_7d: count_records_since(raw_data.accounts_users, window.seven_days_start),
    new_30d: count_records_since(raw_data.accounts_users, window.thirty_days_start),
    current_session_users: count_unique(
      raw_data.accounts_sessions
        .filter((item) => read_string(item.status) === "active" || read_time(item.expires_at ?? item.expires_at) > window.now)
        .map((item) => read_string(item.user_id ?? item.user_id)),
    ),
    new_in_range: raw_data.accounts_users.filter((item) => in_range(item, window)).length,
    recent_users: sort_recent(raw_data.accounts_users).slice(0, 10),
  };

  const activity = {
    active_today: read_number(usage_activity.daily_active_users),
    active_7d: read_number(usage_activity.weekly_active_users),
    active_30d: read_number(usage_activity.monthly_active_users),
    active_in_range,
    stickiness_today_over_30d: read_nullable_number(usage_activity.daily_monthly_stickiness),
    recent_events: [...raw_data.usage_users]
      .sort((left, right) => read_time(right.last_active_at) - read_time(left.last_active_at))
      .slice(0, 20)
      .map((item) => ({ ...item, created_at: item.last_active_at, service: "ai", status: `${read_number(item.execution_count)} calls` })),
  };

  return {
    generated_at: new Date(window.now).toISOString(),
    range,
    services: raw_data.services,
    users,
    activity,
    payment: {
      paying_users_total: first_paid_times.size,
      paying_users_range,
      first_paid_users_range: count_first_paid_in_range(first_paid_times, window),
      paid_orders_range: range_paid_payments.length,
      pending_orders: raw_data.payment_payments.filter((item) => read_string(item.status) === "pending").length,
      failed_orders_range: raw_data.payment_payments.filter((item) => in_range(item, window) && is_failed_payment_status(read_string(item.status))).length,
      registered_to_paid_rate: safe_rate(first_paid_times.size, users.total_registered),
      active_to_paid_rate: safe_rate(paying_users_range, active_in_range),
      recent_payments: sort_recent(raw_data.payment_payments).slice(0, 20),
    },
    revenue: {
      total: read_revenue(paid_payments_with_amount),
      range: read_revenue(range_paid_payments_with_amount),
      today: read_revenue(paid_payments.filter((item) => has_amount_minor(item) && is_since(read_row_time(item), window.today_start))),
    },
    credits: {
      current_balance_total: raw_data.credits_users.reduce((sum, item) => sum + read_number(item.available_credits), 0),
      credited_total: raw_data.credits_topups
        .filter((item) => read_string(item.status) === "applied")
        .reduce((sum, item) => sum + read_number(item.credits), 0),
      paid_topup_credits_range: raw_data.credits_topups
        .filter((item) => read_string(item.status) === "applied" && in_range(item, window))
        .reduce((sum, item) => sum + read_number(item.credits), 0),
      pending_topups: raw_data.payment_payments.filter((item) => read_string(item.status) === "pending").length,
    },
    usage: {
      total_events: usage_event_count,
      events_range: usage_event_count,
      success_events_range: read_number(usage_summary.succeeded_count),
      error_events_range,
      error_rate_range: usage_error_rate_range,
      top_services: usage_event_count > 0 ? [{ service: "ai", count: usage_event_count }] : [],
      top_models: read_top_usage_models(raw_data.usage_users),
    },
    health: {
      missing_revenue_amount_count: paid_payments.length - paid_payments_with_amount.length,
      payment_webhook_failed_events: raw_data.payment_events.filter((item) => read_string(item.sync_status) === "failed").length,
      usage_error_rate_range,
      stale_data_warnings: build_warnings(raw_data, paid_payments.length - paid_payments_with_amount.length, usage_error_rate_range),
    },
  };
}

/**
 * 创建时间窗口。
 */
function create_window(range: dashboard_range): dashboard_window {
  const now_date = new Date();
  const today_start = new Date(now_date);
  today_start.setHours(0, 0, 0, 0);
  const now = now_date.getTime();
  const range_start = range === "today"
    ? today_start.getTime()
    : range === "7d"
      ? now - 7 * DAY_MS
      : range === "30d"
        ? now - 30 * DAY_MS
        : undefined;

  return {
    now,
    today_start: today_start.getTime(),
    range_start,
    seven_days_start: now - 7 * DAY_MS,
    thirty_days_start: now - 30 * DAY_MS,
  };
}

/**
 * 构建健康警告。
 */
function build_warnings(raw_data: dashboard_raw_data, missing_amount_count: number, error_rate: number | null): string[] {
  const warnings: string[] = [];
  if (missing_amount_count > 0) warnings.push(`paid payments missing amount_minor: ${missing_amount_count}`);
  if (error_rate !== null && error_rate > 0.05) warnings.push(`usage error rate is high: ${(error_rate * 100).toFixed(1)}%`);
  for (const [service, state] of Object.entries(raw_data.services)) {
    if (state.status !== "ready") warnings.push(`${service}: ${state.status}${state.message ? ` (${state.message})` : ""}`);
  }
  return warnings;
}

function in_range(row: dashboard_record, window: dashboard_window): boolean {
  if (window.range_start === undefined) return true;
  return is_since(read_row_time(row), window.range_start);
}

function count_records_since(rows: dashboard_record[], start_time: number): number {
  return rows.filter((row) => is_since(read_row_created_at(row), start_time)).length;
}

function read_first_paid_times(rows: dashboard_record[]): Map<string, number> {
  const first_paid_times = new Map<string, number>();
  for (const row of rows) {
    const user_id = read_string(row.user_id);
    const paid_time = read_row_time(row);
    if (!user_id || !Number.isFinite(paid_time)) continue;
    const current = first_paid_times.get(user_id);
    if (current === undefined || paid_time < current) first_paid_times.set(user_id, paid_time);
  }
  return first_paid_times;
}

function count_first_paid_in_range(first_paid_times: Map<string, number>, window: dashboard_window): number {
  return [...first_paid_times.values()].filter((time) => window.range_start === undefined || time >= window.range_start).length;
}

function read_revenue(rows: dashboard_record[]): dashboard_money_group[] {
  const by_currency = new Map<string, number>();
  for (const row of rows) {
    const currency = read_string(row.currency).toUpperCase() || "UNKNOWN";
    by_currency.set(currency, (by_currency.get(currency) ?? 0) + read_number(row.amount_minor));
  }
  return [...by_currency.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount_minor]) => ({
      currency,
      amount_minor,
      display: format_money(currency, amount_minor),
    }));
}

function read_top_usage_models(rows: dashboard_record[]): Array<{ model_id: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = read_string(row.top_model_id);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + read_number(row.execution_count));
  }
  return [...counts.entries()]
    .map(([model_id, count]) => ({ model_id, count }))
    .sort((left, right) => right.count - left.count || left.model_id.localeCompare(right.model_id))
    .slice(0, 5);
}

function sort_recent(rows: dashboard_record[]): dashboard_record[] {
  return [...rows].sort((left, right) => read_row_time(right) - read_row_time(left));
}

function has_amount_minor(row: dashboard_record): boolean {
  const amount = Number(row.amount_minor);
  return Number.isFinite(amount) && amount > 0;
}

function read_row_created_at(row: dashboard_record): number {
  return read_time(row.created_at ?? row.created_at ?? row.auth_created_at ?? row.profile_created_at);
}

function read_row_time(row: dashboard_record): number {
  const updated_time = read_time(row.updated_at ?? row.updated_at);
  return Number.isFinite(updated_time) ? updated_time : read_row_created_at(row);
}

function is_since(value: unknown, start_time: number): boolean {
  const time = read_time(value);
  return Number.isFinite(time) && time >= start_time;
}

function read_time(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return normalize_epoch_time(value);
  if (typeof value === "string" && value.trim()) {
    const numeric_value = Number(value);
    if (Number.isFinite(numeric_value) && /^-?\d+(?:\.\d+)?$/u.test(value.trim())) return normalize_epoch_time(numeric_value);
    return Date.parse(value);
  }
  return Number.NaN;
}

function normalize_epoch_time(value: number): number {
  return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
}

function is_failed_payment_status(status: string): boolean {
  return status === "failed" || status === "expired" || status === "canceled";
}

function safe_rate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

function count_unique(values: string[]): number {
  return new Set(values.filter(Boolean)).size;
}

function read_string(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function read_number(value: unknown): number {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) ? normalized : 0;
}

function read_nullable_number(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function read_record(value: unknown): dashboard_record {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as dashboard_record
    : {};
}

function format_money(currency: string, amount_minor: number): string {
  const divisor = currency_minor_divisor(currency);
  const amount = amount_minor / divisor;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(divisor === 1 ? 0 : 2)}`;
  }
}

function currency_minor_divisor(currency: string): number {
  const zero_decimal = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
  return zero_decimal.has(currency.toUpperCase()) ? 1 : 100;
}
