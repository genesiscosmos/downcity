/**
 * fed Admin Dashboard 展示格式化模块。
 *
 * 关键说明（中文）
 * - 这里只负责把 metrics 转为 TUI table rows。
 * - 业务计算不放在这里，避免展示层和指标口径耦合。
 */

import { t } from "@/shared/CliLocale.js";
import type { admin_tui_table_row } from "@/federation/types/AdminTui.js";
import type {
  dashboard_money_group,
  dashboard_range,
  dashboard_snapshot,
  dashboard_view,
} from "@/federation/types/AdminDashboard.js";

/**
 * 视图标题。
 */
export function dashboard_view_title(view: dashboard_view, range: dashboard_range): string {
  const suffix = ` · ${range_label(range)}`;
  if (view === "overview") return t({ zh: `用户系统 Dashboard${suffix}`, en: `User system dashboard${suffix}` });
  if (view === "users") return t({ zh: `用户${suffix}`, en: `Users${suffix}` });
  if (view === "activity") return t({ zh: `活跃${suffix}`, en: `Activity${suffix}` });
  if (view === "payment") return t({ zh: `付费${suffix}`, en: `Payment${suffix}` });
  if (view === "revenue") return t({ zh: `收入${suffix}`, en: `Revenue${suffix}` });
  if (view === "usage") return t({ zh: `用量${suffix}`, en: `Usage${suffix}` });
  if (view === "health") return t({ zh: `健康${suffix}`, en: `Health${suffix}` });
  return t({ zh: "服务状态", en: "Service status" });
}

/**
 * range 展示文本。
 */
export function range_label(range: dashboard_range): string {
  if (range === "today") return t({ zh: "今日", en: "Today" });
  if (range === "7d") return t({ zh: "7 天", en: "7d" });
  if (range === "30d") return t({ zh: "30 天", en: "30d" });
  return t({ zh: "全部", en: "All" });
}

/**
 * 视图行。
 */
export function dashboard_rows(view: dashboard_view, snapshot: dashboard_snapshot): admin_tui_table_row[] {
  if (view === "overview") return overview_rows(snapshot);
  if (view === "users") return user_rows(snapshot);
  if (view === "activity") return activity_rows(snapshot);
  if (view === "payment") return payment_rows(snapshot);
  if (view === "revenue") return revenue_rows(snapshot);
  if (view === "usage") return usage_rows(snapshot);
  if (view === "health") return health_rows(snapshot);
  return availability_rows(snapshot);
}

function overview_rows(snapshot: dashboard_snapshot): admin_tui_table_row[] {
  return [
    row(t({ zh: "用户", en: "Users" }), t({ zh: "注册用户", en: "Registered users" }), format_number(snapshot.users.total_registered)),
    row(t({ zh: "用户", en: "Users" }), t({ zh: "Range 新增", en: "New in range" }), format_number(snapshot.users.new_in_range)),
    row(t({ zh: "用户", en: "Users" }), t({ zh: "当前登录", en: "Current sessions" }), format_number(snapshot.users.current_session_users)),
    row(t({ zh: "活跃", en: "Activity" }), t({ zh: "Range 活跃", en: "Active in range" }), format_number(snapshot.activity.active_in_range)),
    row(t({ zh: "活跃", en: "Activity" }), t({ zh: "Stickiness", en: "Stickiness" }), format_rate(snapshot.activity.stickiness_today_over_30d)),
    row(t({ zh: "付费", en: "Payment" }), t({ zh: "付费用户", en: "Paying users" }), format_number(snapshot.payment.paying_users_total)),
    row(t({ zh: "付费", en: "Payment" }), t({ zh: "Range 首付用户", en: "First paid in range" }), format_number(snapshot.payment.first_paid_users_range)),
    row(t({ zh: "付费", en: "Payment" }), t({ zh: "注册转付费", en: "Registered to paid" }), format_rate(snapshot.payment.registered_to_paid_rate)),
    ...money_rows(t({ zh: "收入", en: "Revenue" }), t({ zh: "Range 收入", en: "Range revenue" }), snapshot.revenue.range),
    ...money_rows(t({ zh: "收入", en: "Revenue" }), t({ zh: "总收入", en: "Total revenue" }), snapshot.revenue.total),
    row(t({ zh: "用量", en: "Usage" }), t({ zh: "Range 调用", en: "Events in range" }), format_number(snapshot.usage.events_range)),
    row(t({ zh: "用量", en: "Usage" }), t({ zh: "错误率", en: "Error rate" }), format_rate(snapshot.usage.error_rate_range)),
    row(t({ zh: "健康", en: "Health" }), t({ zh: "Warnings", en: "Warnings" }), format_number(snapshot.health.stale_data_warnings.length)),
  ];
}

function user_rows(snapshot: dashboard_snapshot): admin_tui_table_row[] {
  return [
    row("Accounts", t({ zh: "注册用户", en: "Registered users" }), format_number(snapshot.users.total_registered)),
    row("Accounts", t({ zh: "今日新增", en: "New today" }), format_number(snapshot.users.new_today)),
    row("Accounts", t({ zh: "7 天新增", en: "New 7d" }), format_number(snapshot.users.new_7d)),
    row("Accounts", t({ zh: "30 天新增", en: "New 30d" }), format_number(snapshot.users.new_30d)),
    row("Accounts", t({ zh: "Range 新增", en: "New in range" }), format_number(snapshot.users.new_in_range)),
    row("Accounts", t({ zh: "当前登录", en: "Current sessions" }), format_number(snapshot.users.current_session_users)),
    ...snapshot.users.recent_users.map((item) => row(
      t({ zh: "最近用户", en: "Recent user" }),
      read_text(item.user_id ?? item.id),
      `${read_text(item.auth_email ?? item.email)} ${format_date(item.auth_created_at ?? item.created_at ?? item.created_at)}`,
    )),
  ];
}

function activity_rows(snapshot: dashboard_snapshot): admin_tui_table_row[] {
  return [
    row("Usage", t({ zh: "今日活跃", en: "Active today" }), format_number(snapshot.activity.active_today)),
    row("Usage", t({ zh: "7 天活跃", en: "Active 7d" }), format_number(snapshot.activity.active_7d)),
    row("Usage", t({ zh: "30 天活跃", en: "Active 30d" }), format_number(snapshot.activity.active_30d)),
    row("Usage", t({ zh: "Range 活跃", en: "Active in range" }), format_number(snapshot.activity.active_in_range)),
    row("Usage", "Stickiness", format_rate(snapshot.activity.stickiness_today_over_30d)),
    ...snapshot.activity.recent_events.map((item) => row(
      t({ zh: "最近事件", en: "Recent event" }),
      format_date(item.created_at),
      `${read_text(item.user_id)} · ${read_text(item.service)} · ${read_text(item.status)}`,
    )),
  ];
}

function payment_rows(snapshot: dashboard_snapshot): admin_tui_table_row[] {
  return [
    row("Payment", t({ zh: "付费用户", en: "Paying users" }), format_number(snapshot.payment.paying_users_total)),
    row("Payment", t({ zh: "Range 付费用户", en: "Paying users in range" }), format_number(snapshot.payment.paying_users_range)),
    row("Payment", t({ zh: "Range 首付用户", en: "First paid in range" }), format_number(snapshot.payment.first_paid_users_range)),
    row("Payment", t({ zh: "Range 成功订单", en: "Paid orders in range" }), format_number(snapshot.payment.paid_orders_range)),
    row("Payment", t({ zh: "待支付订单", en: "Pending orders" }), format_number(snapshot.payment.pending_orders)),
    row("Payment", t({ zh: "Range 失败订单", en: "Failed orders in range" }), format_number(snapshot.payment.failed_orders_range)),
    row("Conversion", t({ zh: "注册转付费", en: "Registered to paid" }), format_rate(snapshot.payment.registered_to_paid_rate)),
    row("Conversion", t({ zh: "活跃转付费", en: "Active to paid" }), format_rate(snapshot.payment.active_to_paid_rate)),
    ...snapshot.payment.recent_payments.map((item) => row(
      t({ zh: "最近支付", en: "Recent payment" }),
      format_date(item.updated_at ?? item.created_at),
      `${read_text(item.user_id)} · ${format_money_value(item)} · ${read_text(item.status)}`,
    )),
  ];
}

function revenue_rows(snapshot: dashboard_snapshot): admin_tui_table_row[] {
  return [
    ...money_rows("Revenue", t({ zh: "总收入", en: "Total revenue" }), snapshot.revenue.total),
    ...money_rows("Revenue", t({ zh: "Range 收入", en: "Range revenue" }), snapshot.revenue.range),
    ...money_rows("Revenue", t({ zh: "今日收入", en: "Today revenue" }), snapshot.revenue.today),
    row("Health", t({ zh: "缺少金额的 paid payment", en: "Paid payments missing amount" }), format_number(snapshot.health.missing_revenue_amount_count)),
    row("Credits", t({ zh: "Range 入账 credits", en: "Applied topups in range" }), format_number(snapshot.credits.paid_topup_credits_range)),
    row("Credits", t({ zh: "累计入账 credits", en: "Credited total" }), format_number(snapshot.credits.credited_total)),
    row("Credits", t({ zh: "当前可用 credits", en: "Current available credits" }), format_number(snapshot.credits.current_balance_total)),
    row("Payment", t({ zh: "待支付订单", en: "Pending orders" }), format_number(snapshot.credits.pending_topups)),
  ];
}

function usage_rows(snapshot: dashboard_snapshot): admin_tui_table_row[] {
  return [
    row("Usage", t({ zh: "总调用", en: "Total events" }), format_number(snapshot.usage.total_events)),
    row("Usage", t({ zh: "Range 调用", en: "Events in range" }), format_number(snapshot.usage.events_range)),
    row("Usage", t({ zh: "Range 成功", en: "Success in range" }), format_number(snapshot.usage.success_events_range)),
    row("Usage", t({ zh: "Range 失败", en: "Errors in range" }), format_number(snapshot.usage.error_events_range)),
    row("Usage", t({ zh: "错误率", en: "Error rate" }), format_rate(snapshot.usage.error_rate_range)),
    ...snapshot.usage.top_services.map((item) => row("Top service", item.service, format_number(item.count))),
    ...snapshot.usage.top_models.map((item) => row("Top model", item.model_id, format_number(item.count))),
  ];
}

function health_rows(snapshot: dashboard_snapshot): admin_tui_table_row[] {
  const warning_rows = snapshot.health.stale_data_warnings.length > 0
    ? snapshot.health.stale_data_warnings.map((warning) => row("Warning", warning, ""))
    : [row("Warning", t({ zh: "暂无", en: "None" }), "")];

  return [
    row("Revenue", t({ zh: "缺少 amount_minor", en: "Missing amount_minor" }), format_number(snapshot.health.missing_revenue_amount_count)),
    row("Payment", t({ zh: "Webhook failed events", en: "Webhook failed events" }), format_number(snapshot.health.payment_webhook_failed_events)),
    row("Usage", t({ zh: "Range 错误率", en: "Range error rate" }), format_rate(snapshot.health.usage_error_rate_range)),
    ...warning_rows,
  ];
}

function availability_rows(snapshot: dashboard_snapshot): admin_tui_table_row[] {
  return Object.entries(snapshot.services).map(([service, state]) => row(
    service,
    state.status,
    `${state.fetched_endpoints.join(", ") || "-"}${state.message ? ` · ${state.message}` : ""}`,
  ));
}

function row(group: string, metric: string, value: string): admin_tui_table_row {
  return { cells: [group, metric, value] };
}

function money_rows(group: string, metric: string, values: dashboard_money_group[]): admin_tui_table_row[] {
  if (values.length === 0) return [row(group, metric, "0")];
  return values.map((item) => row(group, `${metric} ${item.currency}`, item.display));
}

function format_money_value(item: Record<string, unknown>): string {
  const currency = read_text(item.currency).toUpperCase() || "UNKNOWN";
  const amount_minor = Number(item.amount_minor);
  if (!Number.isFinite(amount_minor) || amount_minor <= 0) return "-";
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

function format_number(value: number): string {
  return new Intl.NumberFormat("en-US").format(Number.isFinite(value) ? value : 0);
}

function format_rate(value: number | null): string {
  if (value === null) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function read_text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "-" : String(value).trim();
}

function format_date(value: unknown): string {
  const time = read_time(value);
  if (!Number.isFinite(time)) return "-";
  return new Date(time).toISOString().slice(0, 19);
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
