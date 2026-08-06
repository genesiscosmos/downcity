/** Fedman React 组件、页面与加载状态类型。 */

import type { ReactNode } from "react";
import type { RetentionCohort, UsageUser } from "./api.js";
import type { AnalyticsRange, FedmanPageDefinition, FedmanPageId } from "./navigation.js";
import type { FederationContext } from "./api.js";

/** 不属于 Analytics 或调试器的管理资源页面。 */
export type ResourcePageId = Exclude<FedmanPageId, "overview" | "activity" | "consumption" | "retention" | "quality" | "usage" | "debugger">;

/** 应用框架输入。 */
export interface LayoutProps {
  /** 当前页面定义。 */
  page: FedmanPageDefinition;
  /** 当前 Analytics 时间范围。 */
  range: AnalyticsRange;
  /** 当前 Federation 连接信息及其加载状态。 */
  context_state: RemoteDataState<FederationContext>;
  /** 页面切换回调。 */
  on_page_change: (page_id: FedmanPageId) => void;
  /** Analytics 时间范围切换回调。 */
  on_range_change: (range: AnalyticsRange) => void;
  /** 请求当前页面重新加载的回调。 */
  on_refresh: () => void;
  /** 退出当前管理员 Session。 */
  on_logout: () => void;
  /** 当前页面主体。 */
  children: ReactNode;
}

/** 管理员登录页输入。 */
export interface LoginPageProps {
  /** 当前 Federation 连接信息。 */
  context: FederationContext;
  /** 登录成功后的回调。 */
  on_login: () => void;
}

/** 单张指标卡内容。 */
export interface MetricItem {
  /** 指标名称。 */
  label: string;
  /** 已格式化的指标值。 */
  value: string;
  /** 指标补充说明。 */
  hint: string;
  /** 可选视觉强调色。 */
  tone?: "accent";
}

/** 指标卡网格输入。 */
export interface MetricCardsProps {
  /** 按展示顺序排列的指标。 */
  items: MetricItem[];
}

/** 内容面板输入。 */
export interface PanelProps {
  /** 面板标题。 */
  title: string;
  /** 标题右侧的短元数据。 */
  meta?: string;
  /** 可选附加类名。 */
  class_name?: string;
  /** 面板主体。 */
  children: ReactNode;
}

/** 加载、错误或空数据状态输入。 */
export interface MessageStateProps {
  /** 状态消息。 */
  children: ReactNode;
  /** 状态视觉类型。 */
  tone?: "loading" | "error" | "empty";
  /** 是否使用紧凑间距。 */
  compact?: boolean;
}

/** 已有数据刷新期间的非阻断状态输入。 */
export interface RemoteDataNoticeProps {
  /** 当前是否正在后台刷新数据。 */
  refreshing: boolean;
  /** 最近一次刷新失败；没有失败时为空。 */
  error: Error | null;
}

/** 图表中的单条序列。 */
export interface ChartSeries {
  /** 图例展示名称。 */
  label: string;
  /** 数据对象中的数值字段。 */
  key: string;
  /** SVG 使用的颜色。 */
  color: string;
}

/** 折线图输入。 */
export interface LineChartProps {
  /** 按横轴顺序排列的数据。 */
  data: object[];
  /** 需要绘制的数值序列。 */
  series: ChartSeries[];
  /** 是否把纵轴格式化为百分比。 */
  percent?: boolean;
}

/** 柱状图输入。 */
export interface BarChartProps {
  /** 按横轴顺序排列的数据。 */
  data: object[];
  /** 柱高使用的数值字段。 */
  value_key: string;
  /** 横轴标签使用的字段。 */
  label_key: string;
  /** 柱体颜色。 */
  color: string;
  /** 可选横轴标签格式化函数。 */
  label_format?: (value: unknown) => string;
}

/** 堆叠柱状图输入。 */
export interface StackedChartProps {
  /** 按横轴顺序排列的数据。 */
  data: object[];
  /** 从下至上绘制的数值序列。 */
  series: ChartSeries[];
}

/** 横向排行条输入。 */
export interface HorizontalBarsProps {
  /** 按展示顺序排列的数据。 */
  data: object[];
  /** 条形长度使用的数值字段。 */
  value_key: string;
  /** 行名称使用的字段。 */
  label_key: string;
  /** 条形颜色。 */
  color: string;
}

/** 留存漏斗单项。 */
export interface FunnelItem {
  /** 留存观察日名称。 */
  label: string;
  /** 当前观察日的留存率。 */
  value: number | null;
}

/** 留存漏斗输入。 */
export interface FunnelChartProps {
  /** 从短期到长期排列的留存率。 */
  items: FunnelItem[];
}

/** 图表图例输入。 */
export interface ChartLegendProps {
  /** 需要在图例中解释的序列。 */
  series: ChartSeries[];
}

/** 所有 Analytics 页面共享输入。 */
export interface AnalyticsPageProps {
  /** 当前查询时间范围。 */
  range: AnalyticsRange;
  /** 外层刷新动作递增的版本号。 */
  refresh_key: number;
}

/** Token 消耗排行输入。 */
export interface UserRankingProps {
  /** 已按 Total Tokens 降序排列的用户。 */
  users: UsageUser[];
}

/** Cohort 留存表输入。 */
export interface CohortTableProps {
  /** 按注册日期排列的 Cohort。 */
  cohorts: RetentionCohort[];
}

/** 单个留存热力单元格输入。 */
export interface RetentionCellProps {
  /** 当前固定观察日的留存率；尚不可观察时为空。 */
  value: number | null;
}

/** 用户明细页面输入。 */
export interface UsageUsersPageProps {
  /** 当前查询时间范围。 */
  range: AnalyticsRange;
  /** 外层刷新动作递增的版本号。 */
  refresh_key: number;
}

/** 用户表支持的排序字段。 */
export type UsageSortKey = "total_tokens" | "credits_used" | "execution_count" | "p95_duration_ms" | "last_active_at";

/** 用户表输入。 */
export interface UsageTableProps {
  /** 当前页用户。 */
  users: UsageUser[];
  /** 选择用户查看详情的回调。 */
  on_select: (user: UsageUser) => void;
}

/** 用户详情抽屉输入。 */
export interface UsageDrawerProps {
  /** 当前查看的用户。 */
  user: UsageUser;
  /** 关闭抽屉回调。 */
  on_close: () => void;
}

/** 管理资源页输入。 */
export interface ResourcePageProps {
  /** 当前资源页面 ID。 */
  resource_id: ResourcePageId;
  /** 外层刷新动作递增的版本号。 */
  refresh_key: number;
}

/** 可发送给 CLI BFF 的资源管理动作。 */
export type ResourceAction = "env_upsert" | "env_remove" | "env_refresh" | "bureau_create" | "bureau_activate" | "bureau_pause" | "bureau_archive";

/** Service 调试器允许的 HTTP 方法。 */
export type DebuggerMethod = "GET" | "POST";

/** 资源管理动作完成后的反馈消息。 */
export interface ResourceNotice {
  /** 反馈的语义类型。 */
  tone: "success" | "error";
  /** 面向管理员展示的反馈内容。 */
  message: string;
}

/** 通用资源表输入。 */
export interface ResourceTableProps {
  /** 需要展示的资源记录。 */
  items: Array<Record<string, unknown>>;
}

/** 页面内容路由输入。 */
export interface PageContentProps {
  /** 当前页面稳定 ID。 */
  page_id: FedmanPageId;
  /** 当前 Analytics 时间范围。 */
  range: AnalyticsRange;
  /** 外层刷新动作递增的版本号。 */
  refresh_key: number;
}

/** 远端数据加载状态。 */
export interface RemoteDataState<T> {
  /** 成功加载的数据；加载前为空。 */
  data: T | null;
  /** 当前是否正在加载。 */
  loading: boolean;
  /** 已有数据是否正在后台刷新。 */
  refreshing: boolean;
  /** 最近一次加载错误；成功时为空。 */
  error: Error | null;
}
