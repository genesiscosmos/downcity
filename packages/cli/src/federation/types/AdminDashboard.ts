/**
 * fed Admin 用户系统 Dashboard 类型。
 *
 * 关键说明（中文）
 * - Dashboard 是 CLI 内部运营视图，数据来自现有 admin endpoints。
 * - 类型按 raw data、metrics、view state 分层，避免展示逻辑直接依赖 endpoint 原始形态。
 */

/**
 * Dashboard 时间范围。
 */
export type dashboard_range = "today" | "7d" | "30d" | "all";

/**
 * Dashboard 服务状态。
 */
export type dashboard_service_status = "ready" | "missing" | "error" | "partial";

/**
 * Dashboard 依赖服务 ID。
 */
export type dashboard_service_id = "accounts" | "usage" | "credits" | "payment";

/**
 * Dashboard 视图。
 */
export type dashboard_view =
  | "overview"
  | "users"
  | "activity"
  | "payment"
  | "revenue"
  | "usage"
  | "health"
  | "availability";

/**
 * Dashboard 服务读取状态。
 */
export interface dashboard_service_state {
  /** 服务读取状态。 */
  status: dashboard_service_status;

  /** 已成功读取的 endpoint。 */
  fetched_endpoints: string[];

  /** 读取失败或缺失说明。 */
  message: string;
}

/**
 * Dashboard 服务状态集合。
 */
export type dashboard_service_state_map = Record<dashboard_service_id, dashboard_service_state>;

/**
 * 通用原始记录。
 */
export type dashboard_record = Record<string, unknown>;

/**
 * Dashboard 原始数据缓存。
 */
export interface dashboard_raw_data {
  /** 生成/刷新时间。 */
  fetched_at: string;

  /** 服务状态。 */
  services: dashboard_service_state_map;

  /** accounts 用户记录。 */
  accounts_users: dashboard_record[];

  /** accounts session 记录。 */
  accounts_sessions: dashboard_record[];

  /** usage event 记录。 */
  usage_events: dashboard_record[];

  /** Credits 用户汇总记录。 */
  credits_users: dashboard_record[];

  /** Credits Topup Transactions。 */
  credits_topups: dashboard_record[];

  /** payment 记录。 */
  payment_payments: dashboard_record[];

  /** payment webhook event 记录。 */
  payment_events: dashboard_record[];
}

/**
 * Dashboard 时间窗口。
 */
export interface dashboard_window {
  /** 当前时间。 */
  now: number;

  /** 今日起点。 */
  today_start: number;

  /** 当前 range 起点；all 时为 undefined。 */
  range_start?: number;

  /** 近 7 天起点。 */
  seven_days_start: number;

  /** 近 30 天起点。 */
  thirty_days_start: number;
}

/**
 * 用户指标。
 */
export interface dashboard_users_metrics {
  /** 总注册用户数。 */
  total_registered: number;

  /** 今日新增用户数。 */
  new_today: number;

  /** 近 7 天新增用户数。 */
  new_7d: number;

  /** 近 30 天新增用户数。 */
  new_30d: number;

  /** 当前未过期 session 去重用户数。 */
  current_session_users: number;

  /** 当前 range 内新增用户数。 */
  new_in_range: number;

  /** 最近用户列表。 */
  recent_users: dashboard_record[];
}

/**
 * 活跃指标。
 */
export interface dashboard_activity_metrics {
  /** 今日活跃用户数。 */
  active_today: number;

  /** 近 7 天活跃用户数。 */
  active_7d: number;

  /** 近 30 天活跃用户数。 */
  active_30d: number;

  /** 当前 range 内活跃用户数。 */
  active_in_range: number;

  /** 今日活跃 / 30 天活跃。 */
  stickiness_today_over_30d: number | null;

  /** 最近 usage event。 */
  recent_events: dashboard_record[];
}

/**
 * 支付指标。
 */
export interface dashboard_payment_metrics {
  /** 至少有一笔 paid payment 的用户数。 */
  paying_users_total: number;

  /** 当前 range 内有 paid payment 的用户数。 */
  paying_users_range: number;

  /** 第一笔 paid payment 发生在当前 range 内的用户数。 */
  first_paid_users_range: number;

  /** 当前 range 内成功订单数。 */
  paid_orders_range: number;

  /** 全量待支付订单数。 */
  pending_orders: number;

  /** 当前 range 内失败/取消/过期订单数。 */
  failed_orders_range: number;

  /** 注册到付费转化率。 */
  registered_to_paid_rate: number | null;

  /** 当前 range 活跃到当前 range 付费转化率。 */
  active_to_paid_rate: number | null;

  /** 最近 payment 记录。 */
  recent_payments: dashboard_record[];
}

/**
 * 金额聚合。
 */
export interface dashboard_money_group {
  /** 币种。 */
  currency: string;

  /** 最小货币单位金额。 */
  amount_minor: number;

  /** 展示文本。 */
  display: string;
}

/**
 * 收入指标。
 */
export interface dashboard_revenue_metrics {
  /** 全量收入。 */
  total: dashboard_money_group[];

  /** 当前 range 收入。 */
  range: dashboard_money_group[];

  /** 今日收入。 */
  today: dashboard_money_group[];
}

/**
 * 余额指标。
 */
export interface dashboard_credits_metrics {
  /** 当前余额 credits 总和。 */
  current_balance_total: number;

  /** 全量已支付 topup credits 总和。 */
  credited_total: number;

  /** 当前 range 内已支付 topup credits。 */
  paid_topup_credits_range: number;

  /** 全量 pending topup 数。 */
  pending_topups: number;
}

/**
 * 用量指标。
 */
export interface dashboard_usage_metrics {
  /** 总 usage event 数。 */
  total_events: number;

  /** 当前 range 内 event 数。 */
  events_range: number;

  /** 当前 range 内 success event 数。 */
  success_events_range: number;

  /** 当前 range 内 error event 数。 */
  error_events_range: number;

  /** 当前 range 内错误率。 */
  error_rate_range: number | null;

  /** Top services。 */
  top_services: Array<{ service: string; count: number }>;

  /** Top models。 */
  top_models: Array<{ model_id: string; count: number }>;
}

/**
 * 健康指标。
 */
export interface dashboard_health_metrics {
  /** paid payment 缺少 amount_minor 的数量。 */
  missing_revenue_amount_count: number;

  /** payment webhook 同步失败事件数。 */
  payment_webhook_failed_events: number;

  /** 当前 range 内 usage 错误率。 */
  usage_error_rate_range: number | null;

  /** 数据健康警告。 */
  stale_data_warnings: string[];
}

/**
 * Dashboard 指标快照。
 */
export interface dashboard_snapshot {
  /** 指标生成时间。 */
  generated_at: string;

  /** 当前 range。 */
  range: dashboard_range;

  /** 服务读取状态。 */
  services: dashboard_service_state_map;

  /** 用户指标。 */
  users: dashboard_users_metrics;

  /** 活跃指标。 */
  activity: dashboard_activity_metrics;

  /** 支付指标。 */
  payment: dashboard_payment_metrics;

  /** 收入指标。 */
  revenue: dashboard_revenue_metrics;

  /** Credits 指标。 */
  credits: dashboard_credits_metrics;

  /** 用量指标。 */
  usage: dashboard_usage_metrics;

  /** 健康指标。 */
  health: dashboard_health_metrics;
}
