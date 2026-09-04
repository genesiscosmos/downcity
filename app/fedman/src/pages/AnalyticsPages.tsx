/** Fedman 活跃、消耗、留存与质量分析页面。 */

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@downcity/ui";
import { BarChart, FunnelChart, HorizontalBars, LineChart, StackedChart } from "../components/Charts.js";
import { MessageState, MetricCards, Panel, RemoteDataNotice } from "../components/Common.js";
import { use_remote_data } from "../hooks/use_remote_data.js";
import { analytics_url, request_json } from "../lib/api.js";
import { format_compact_number, format_duration, format_number, format_percent } from "../lib/format.js";
import type { RetentionRates, RetentionResponse, UsageOverviewResponse, UsageUser, UsageUsersResponse } from "../types/api.js";
import type { AnalyticsRange } from "../types/navigation.js";
import type { AnalyticsPageProps, ChartSeries, CohortTableProps, FunnelItem, MetricItem, RetentionCellProps, UserRankingProps } from "../types/ui.js";

const activity_series: ChartSeries[] = [
  { label: "DAU", key: "active_user_count", color: "var(--chart-3)" },
  { label: "WAU", key: "weekly_active_user_count", color: "var(--chart-4)" },
  { label: "MAU", key: "monthly_active_user_count", color: "var(--chart-2)" },
];

const token_series: ChartSeries[] = [
  { label: "未缓存输入", key: "uncached_input_tokens", color: "var(--chart-3)" },
  { label: "缓存输入", key: "cached_input_tokens", color: "var(--chart-1)" },
  { label: "输出", key: "output_tokens", color: "var(--chart-4)" },
  { label: "推理", key: "reasoning_tokens", color: "var(--chart-5)" },
];

/** 数据概览。 */
export function OverviewPage({ range, refresh_key }: AnalyticsPageProps) {
  const state = use_remote_data(async () => await Promise.all([
    request_json<UsageOverviewResponse>(analytics_url("overview", range)),
    request_json<UsageUsersResponse>(analytics_url("users", range)),
  ]), [range, refresh_key]);
  if (state.loading) return <MessageState tone="loading">正在读取 Federation 数据…</MessageState>;
  if (state.error && !state.data) return <MessageState tone="error">{state.error.message}</MessageState>;
  if (!state.data) return null;
  const [usage, users] = state.data;
  const summary = usage.summary;
  const ranking = sort_usage_users(users.items, "total_tokens").slice(0, 6);
  const metrics: MetricItem[] = [
    { label: "注册用户", value: format_number(usage.total_registered_users), hint: `范围新增 ${format_number(usage.new_registered_users)}` },
    { label: "DAU", value: format_number(usage.activity.daily_active_users), hint: `粘性 ${format_percent(usage.activity.daily_monthly_stickiness)}`, tone: "accent" },
    { label: "WAU", value: format_number(usage.activity.weekly_active_users), hint: "滚动 7 天去重" },
    { label: "MAU", value: format_number(usage.activity.monthly_active_users), hint: "滚动 30 天去重" },
    { label: "AI 调用", value: format_number(summary.execution_count), hint: `成功率 ${format_percent(summary.success_rate)}` },
    { label: "Total Tokens", value: format_compact_number(summary.total_tokens), hint: `Input ${format_compact_number(summary.input_tokens)} · Output ${format_compact_number(summary.output_tokens)}` },
    { label: "Credits", value: format_compact_number(summary.credits_used), hint: `${format_number(summary.charge_count)} 笔 Charge` },
    { label: "P95 耗时", value: format_duration(usage.performance.p95_duration_ms), hint: `${format_number(usage.performance.sample_count)} 个样本` },
  ];
  return <><RemoteDataNotice refreshing={state.refreshing} error={state.error} /><MetricCards items={metrics} /><div className="analytics-grid wide-left">
    <Panel title="活跃用户趋势" meta={usage.timezone}><LineChart data={usage.days} series={activity_series} /></Panel>
    <Panel title="Token 消耗排行" meta="TOTAL TOKENS · TOP 6"><UserRanking users={ranking} /></Panel>
  </div><div className="analytics-grid">
    <Panel title="调用与成功率" meta={range_label(range)}><LineChart data={usage.days} series={[
      { label: "调用量", key: "execution_count", color: "var(--chart-3)" },
      { label: "成功", key: "succeeded_count", color: "var(--chart-2)" },
      { label: "失败", key: "failed_count", color: "var(--destructive)" },
    ]} /></Panel>
    <Panel title="Token 构成" meta="STACKED"><StackedChart data={usage.days} series={token_series} /></Panel>
  </div></>;
}

/** 用户活跃分析。 */
export function ActivityPage({ range, refresh_key }: AnalyticsPageProps) {
  const state = use_overview(range, refresh_key);
  if (state.loading) return <MessageState tone="loading">正在读取活跃数据…</MessageState>;
  if (state.error && !state.data) return <MessageState tone="error">{state.error.message}</MessageState>;
  if (!state.data) return null;
  const usage = state.data;
  return <><RemoteDataNotice refreshing={state.refreshing} error={state.error} /><MetricCards items={[
    { label: "范围活跃", value: format_number(usage.activity.range_active_users), hint: range_label(range) },
    { label: "DAU", value: format_number(usage.activity.daily_active_users), hint: "当天去重用户", tone: "accent" },
    { label: "WAU", value: format_number(usage.activity.weekly_active_users), hint: "滚动 7 天去重" },
    { label: "MAU", value: format_number(usage.activity.monthly_active_users), hint: "滚动 30 天去重" },
  ]} /><div className="analytics-grid wide-left">
    <Panel title="DAU / WAU / MAU" meta="真实去重口径"><LineChart data={usage.days} series={activity_series} /></Panel>
    <Panel title="24 小时活跃分布" meta="LOCAL TIME"><BarChart data={usage.hours} value_key="execution_count" label_key="hour" color="var(--chart-3)" label_format={(value) => `${String(value).padStart(2, "0")}:00`} /></Panel>
  </div><Panel title="用户粘性 DAU / MAU" meta="DAU ÷ MAU"><LineChart data={usage.days} series={[{ label: "粘性", key: "daily_monthly_stickiness", color: "var(--chart-5)" }]} percent /></Panel></>;
}

/** Usage 消耗分析。 */
export function ConsumptionPage({ range, refresh_key }: AnalyticsPageProps) {
  const state = use_overview(range, refresh_key);
  if (state.loading) return <MessageState tone="loading">正在读取消耗数据…</MessageState>;
  if (state.error && !state.data) return <MessageState tone="error">{state.error.message}</MessageState>;
  if (!state.data) return null;
  const usage = state.data;
  const summary = usage.summary;
  return <><RemoteDataNotice refreshing={state.refreshing} error={state.error} /><MetricCards items={[
    { label: "AI 调用", value: format_number(summary.execution_count), hint: `${format_number(summary.metered_request_count)} 上游请求`, tone: "accent" },
    { label: "Input Token", value: format_compact_number(summary.input_tokens), hint: `Cached ${format_compact_number(summary.cached_input_tokens)}` },
    { label: "Output Token", value: format_compact_number(summary.output_tokens), hint: `Reasoning ${format_compact_number(summary.reasoning_tokens)}` },
    { label: "Credits 消耗", value: format_compact_number(summary.credits_used), hint: `${format_number(summary.charge_count)} 笔 Charge` },
  ]} /><div className="analytics-grid">
    <Panel title="每日调用量" meta={range_label(range)}><BarChart data={usage.days} value_key="execution_count" label_key="date" color="var(--chart-3)" /></Panel>
    <Panel title="每日 Credits" meta="APPLIED CHARGES"><BarChart data={usage.days} value_key="credits_used" label_key="date" color="var(--chart-4)" /></Panel>
  </div><Panel title="Token 每日构成" meta="STACKED"><StackedChart data={usage.days} series={token_series} /></Panel>
  <div className="analytics-grid"><Panel title="模型调用分布" meta="TOP 10"><HorizontalBars data={usage.models.slice(0, 10)} value_key="execution_count" label_key="key" color="var(--chart-3)" /></Panel><Panel title="Action 分布" meta="TOP 10"><HorizontalBars data={usage.actions.slice(0, 10)} value_key="execution_count" label_key="key" color="var(--chart-2)" /></Panel></div></>;
}

/** 注册 Cohort 留存分析。 */
export function RetentionPage({ range, refresh_key }: AnalyticsPageProps) {
  const state = use_remote_data(async () => await request_json<RetentionResponse>(analytics_url("retention", range)), [range, refresh_key]);
  if (state.loading) return <MessageState tone="loading">正在读取留存数据…</MessageState>;
  if (state.error && !state.data) return <MessageState tone="error">{state.error.message}</MessageState>;
  if (!state.data) return null;
  const data = state.data;
  const rate_items = retention_items(data.average_rates);
  const chart_data = data.cohorts.map((cohort) => ({ date: cohort.date, ...cohort.rates }));
  const metrics: MetricItem[] = [
    { label: "注册用户", value: format_number(data.total_registered_users), hint: "全部注册用户" },
    ...rate_items.map((item, index): MetricItem => ({ label: `${item.label} 留存`, value: format_percent(item.value), hint: "按注册 Cohort 加权", tone: index === 0 ? "accent" : undefined })),
  ];
  return <><RemoteDataNotice refreshing={state.refreshing} error={state.error} /><MetricCards items={metrics} /><div className="analytics-grid wide-left">
    <Panel title="留存率趋势" meta="REGISTRATION COHORT"><LineChart data={chart_data} series={[
      { label: "D1", key: "day_1", color: "var(--chart-1)" }, { label: "D3", key: "day_3", color: "var(--chart-2)" }, { label: "D7", key: "day_7", color: "var(--chart-3)" }, { label: "D14", key: "day_14", color: "var(--chart-4)" }, { label: "D30", key: "day_30", color: "var(--chart-5)" },
    ]} percent /></Panel>
    <Panel title="平均留存漏斗" meta="WEIGHTED"><FunnelChart items={rate_items} /></Panel>
  </div><Panel title="每日新增用户" meta={range_label(range)}><BarChart data={data.registration_days} value_key="new_user_count" label_key="date" color="var(--chart-3)" /></Panel>
  <Panel title="Cohort 留存表" meta="精确日留存"><CohortTable cohorts={data.cohorts} /></Panel></>;
}

/** 调用质量分析。 */
export function QualityPage({ range, refresh_key }: AnalyticsPageProps) {
  const state = use_overview(range, refresh_key);
  if (state.loading) return <MessageState tone="loading">正在读取质量数据…</MessageState>;
  if (state.error && !state.data) return <MessageState tone="error">{state.error.message}</MessageState>;
  if (!state.data) return null;
  const usage = state.data;
  const performance = usage.performance;
  const summary = usage.summary;
  return <><RemoteDataNotice refreshing={state.refreshing} error={state.error} /><MetricCards items={[
    { label: "成功率", value: format_percent(summary.success_rate), hint: `${format_number(summary.succeeded_count)} 次成功`, tone: "accent" },
    { label: "平均耗时", value: format_duration(performance.average_duration_ms), hint: `${format_number(performance.sample_count)} 个样本` },
    { label: "P50 / P95", value: `${format_duration(performance.p50_duration_ms)} / ${format_duration(performance.p95_duration_ms)}`, hint: `最大 ${format_duration(performance.max_duration_ms)}` },
    { label: "计量不可用", value: format_number(performance.metering_unavailable_count), hint: `${format_percent(summary.execution_count ? performance.metering_unavailable_count / summary.execution_count : null)} of calls` },
  ]} /><div className="analytics-grid">
    <Panel title="执行结果趋势" meta="OUTCOME"><StackedChart data={usage.days} series={[{ label: "成功", key: "succeeded_count", color: "var(--chart-2)" }, { label: "失败", key: "failed_count", color: "var(--destructive)" }, { label: "取消", key: "cancelled_count", color: "var(--chart-5)" }]} /></Panel>
    <Panel title="执行耗时趋势" meta="MILLISECONDS"><LineChart data={usage.days} series={[{ label: "平均", key: "average_duration_ms", color: "var(--chart-3)" }, { label: "P95", key: "p95_duration_ms", color: "var(--chart-4)" }]} /></Panel>
  </div><Panel title="模型质量" meta={`${usage.models.length} MODELS`}><Table><TableHeader><TableRow><TableHead>模型</TableHead><TableHead>调用</TableHead><TableHead>成功率</TableHead><TableHead>Tokens</TableHead><TableHead>平均耗时</TableHead></TableRow></TableHeader><TableBody>{usage.models.map((item) => <TableRow key={item.key}><TableCell><strong>{item.key}</strong></TableCell><TableCell>{format_number(item.execution_count)}</TableCell><TableCell>{format_percent(item.execution_count ? item.succeeded_count / item.execution_count : null)}</TableCell><TableCell>{format_compact_number(item.total_tokens)}</TableCell><TableCell>{format_duration(item.average_duration_ms)}</TableCell></TableRow>)}</TableBody></Table></Panel></>;
}

/** 加载统一 Usage 总览。 */
function use_overview(range: AnalyticsRange, refresh_key: number) {
  return use_remote_data(async () => await request_json<UsageOverviewResponse>(analytics_url("overview", range)), [range, refresh_key]);
}

/** 总览 Token 消耗排行。 */
function UserRanking({ users }: UserRankingProps) {
  if (!users.length) return <MessageState compact>暂无活跃用户</MessageState>;
  return <div>{users.map((item, index) => <div className="ranking-row" key={item.user_id}><span className="rank">{index + 1}</span><div className="ranking-user"><strong>{item.email || item.user_id}</strong><small>{item.top_model_id || "暂无模型"}</small></div><div className="ranking-value"><strong>{format_compact_number(item.total_tokens)}</strong><small>{format_number(item.execution_count)} calls</small></div></div>)}</div>;
}

/** Cohort 留存表。 */
function CohortTable({ cohorts }: CohortTableProps) {
  return <Table className="cohort-table"><TableHeader><TableRow><TableHead>注册日期</TableHead><TableHead>新增</TableHead><TableHead>D1</TableHead><TableHead>D3</TableHead><TableHead>D7</TableHead><TableHead>D14</TableHead><TableHead>D30</TableHead></TableRow></TableHeader><TableBody>{cohorts.map((cohort) => <TableRow key={cohort.date}><TableCell>{cohort.date}</TableCell><TableCell>{format_number(cohort.new_user_count)}</TableCell>{([1, 3, 7, 14, 30] as const).map((day) => <TableCell key={day}><RetentionCell value={cohort.rates[`day_${day}`]} /></TableCell>)}</TableRow>)}</TableBody></Table>;
}

/** Cohort 热力单元格。 */
function RetentionCell({ value }: RetentionCellProps) {
  if (value === null) return <span className="retention-cell pending">—</span>;
  const alpha = 0.08 + Math.min(0.72, value * 0.72);
  return <span className="retention-cell" style={{ background: `color-mix(in srgb, var(--chart-3) ${Math.round(alpha * 100)}%, transparent)` }}>{format_percent(value)}</span>;
}

/** 构造固定留存观察日列表。 */
function retention_items(rates: RetentionRates): FunnelItem[] {
  return [{ label: "D1", value: rates.day_1 }, { label: "D3", value: rates.day_3 }, { label: "D7", value: rates.day_7 }, { label: "D14", value: rates.day_14 }, { label: "D30", value: rates.day_30 }];
}

/** 按用户消耗字段稳定排序。 */
function sort_usage_users(items: UsageUser[], sort_key: keyof UsageUser): UsageUser[] {
  return [...items].sort((left, right) => Number(right[sort_key] || 0) - Number(left[sort_key] || 0) || left.user_id.localeCompare(right.user_id));
}

/** 查询范围的中文展示名称。 */
function range_label(range: AnalyticsRange): string {
  return range === "today" ? "今日" : range === "7d" ? "7 天" : range === "30d" ? "30 天" : "全部";
}
