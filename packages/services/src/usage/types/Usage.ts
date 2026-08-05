/**
 * 用户 Credits 与 AI 技术用量聚合契约。
 *
 * Credits 和 AI Usage 是独立事实，UsageService 只把两个 Reader 的每日结果
 * 合并成一个用户响应，不拥有事实副本。
 */

import type {
  AdminAIHourlyUsageBucket,
  AdminAIPerformanceMetrics,
  AdminAIUsageDimensionBucket,
  AIRecentUsageItem,
  AIUsageReader,
} from "@downcity/city";
import type { CreditsUsageReader } from "../../credits/types/Usage.js";

/** UsageService 显式 Reader 依赖。 */
export interface UsageServiceOptions {
  /** AIService 提供的技术用量只读接口。 */
  ai_usage_reader: AIUsageReader;
  /** CreditsService 提供的已入账消费只读接口。 */
  credits_usage_reader: CreditsUsageReader;
  /** AccountsService 提供的注册用户只读接口，用于新增与留存分析。 */
  account_usage_reader: UsageAccountReader;
}

/** Usage 分析所需的最小注册用户事实。 */
export interface UsageAccountRegistration {
  /** Federation 内全局用户 ID。 */
  user_id: string;
  /** 用户首次注册时间，UTC ISO 字符串。 */
  created_at: string;
}

/** Accounts 领域向 Usage 分析投影的最小只读接口。 */
export interface UsageAccountReader {
  /** 列出注册用户及其首次创建时间。 */
  list_usage_account_registrations(): Promise<UsageAccountRegistration[]>;
}

/** 用户 Credits 聚合 Bucket。 */
export interface UserCreditsUsageBucket {
  /** 已入账 Charge 的 Credits 总量。 */
  used: number;
  /** 已入账 Charge 数量。 */
  charge_count: number;
}

/** 用户 AI 技术用量聚合 Bucket。 */
export interface UserAIUsageBucket {
  /** 全部 AI Usage Record 数量。 */
  execution_count: number;
  /** Settled Metering 中的上游请求数量。 */
  metered_request_count: number;
  /** 未命中缓存的输入 Token。 */
  uncached_input_tokens: number;
  /** 命中缓存的输入 Token。 */
  cached_input_tokens: number;
  /** 全部输入 Token。 */
  input_tokens: number;
  /** 输出 Token。 */
  output_tokens: number;
  /** 输出中的推理 Token 子集。 */
  reasoning_tokens: number;
  /** 输入与输出 Token 总量。 */
  total_tokens: number;
  /** 生成图片数量。 */
  image_count: number;
  /** 视频用量秒数。 */
  video_seconds: number;
  /** 音频用量秒数。 */
  audio_seconds: number;
}

/** 用户用量汇总或单日 Bucket。 */
export interface UserUsageBucket {
  /** Credits 账务消费。 */
  credits: UserCreditsUsageBucket;
  /** AI 技术用量。 */
  ai: UserAIUsageBucket;
}

/** 用户用量 API 响应。 */
export interface UserUsageResponse {
  /** 查询使用的 IANA 时区。 */
  timezone: string;
  /** 查询起始当地自然日，包含。 */
  from: string;
  /** 查询结束当地自然日，包含。 */
  to: string;
  /** 一美元对应的 Credits 数量。 */
  credits_per_usd: number;
  /** 两类数据各自的可靠覆盖起点。 */
  data_available_from: {
    /** 第一笔 Applied Charge 的当地日期。 */
    credits: string | null;
    /** 第一条 AI Usage Record 的当地日期。 */
    ai: string | null;
  };
  /** 查询区间内全部每日 Bucket 的字段总和。 */
  summary: UserUsageBucket;
  /** 按日期升序排列的稀疏每日 Bucket。 */
  days: Array<UserUsageBucket & {
    /** 当地自然日，格式为 YYYY-MM-DD。 */
    date: string;
  }>;
}

/** 当前用户最近单次 AI Token 用量响应。 */
export interface UserRecentTokenUsageResponse {
  /** 按完成时间与 Usage ID 降序排列的单次 AI 用量。 */
  items: AIRecentUsageItem[];
  /** 下一页不透明 Cursor；没有更多记录时为空。 */
  next_cursor: string | null;
}

/** Admin Usage 活跃用户指标。 */
export interface AdminUsageActivityMetrics {
  /** 查询范围内去重活跃用户数。 */
  range_active_users: number;
  /** 查询结束日期当天的去重活跃用户数。 */
  daily_active_users: number;
  /** 截至查询结束日期滚动 7 天的去重活跃用户数。 */
  weekly_active_users: number;
  /** 截至查询结束日期滚动 30 天的去重活跃用户数。 */
  monthly_active_users: number;
  /** DAU / MAU；MAU 为零时为空。 */
  daily_monthly_stickiness: number | null;
}

/** Admin 单用户 Usage 聚合。 */
export interface AdminUserUsageItem {
  /** Federation 内全局用户 ID。 */
  user_id: string;
  /** 查询范围内最后一次 AI Usage 完成时间。 */
  last_active_at: string;
  /** AI 执行次数。 */
  execution_count: number;
  /** 成功执行次数。 */
  succeeded_count: number;
  /** 失败执行次数。 */
  failed_count: number;
  /** 取消执行次数。 */
  cancelled_count: number;
  /** 成功执行次数 / AI 执行次数；无调用时为空。 */
  success_rate: number | null;
  /** Settled Metering 中的上游请求数量。 */
  metered_request_count: number;
  /** 未命中缓存的输入 Token。 */
  uncached_input_tokens: number;
  /** 命中缓存的输入 Token。 */
  cached_input_tokens: number;
  /** 全部输入 Token。 */
  input_tokens: number;
  /** 输出 Token。 */
  output_tokens: number;
  /** 推理 Token。 */
  reasoning_tokens: number;
  /** 输入与输出 Token 总量。 */
  total_tokens: number;
  /** 生成图片数量。 */
  image_count: number;
  /** 视频用量秒数。 */
  video_seconds: number;
  /** 音频用量秒数。 */
  audio_seconds: number;
  /** 已入账 Credits 消费。 */
  credits_used: number;
  /** 已入账 Charge 数量。 */
  charge_count: number;
  /** 调用次数最多的模型 ID。 */
  top_model_id: string;
  /** 计量不可用执行次数。 */
  metering_unavailable_count: number;
  /** 平均执行耗时，单位毫秒；无样本时为空。 */
  average_duration_ms: number | null;
  /** P95 执行耗时，单位毫秒；无样本时为空。 */
  p95_duration_ms: number | null;
}

/** Admin 单日 Usage 趋势点。 */
export interface AdminUsageDay {
  /** 当地自然日，格式为 YYYY-MM-DD。 */
  date: string;
  /** 当日去重活跃用户数。 */
  active_user_count: number;
  /** 截至当日滚动 7 天去重活跃用户数。 */
  weekly_active_user_count: number;
  /** 截至当日滚动 30 天去重活跃用户数。 */
  monthly_active_user_count: number;
  /** 当日 DAU / 滚动 MAU；MAU 为零时为空。 */
  daily_monthly_stickiness: number | null;
  /** 当日 AI 执行次数。 */
  execution_count: number;
  /** 当日 Token 总量。 */
  total_tokens: number;
  /** 当日已入账 Credits 消费。 */
  credits_used: number;
  /** 当日成功执行次数。 */
  succeeded_count: number;
  /** 当日失败执行次数。 */
  failed_count: number;
  /** 当日取消执行次数。 */
  cancelled_count: number;
  /** 当日未命中缓存输入 Token。 */
  uncached_input_tokens: number;
  /** 当日缓存输入 Token。 */
  cached_input_tokens: number;
  /** 当日输出 Token。 */
  output_tokens: number;
  /** 当日推理 Token。 */
  reasoning_tokens: number;
  /** 当日计量不可用执行次数。 */
  metering_unavailable_count: number;
  /** 当日平均执行耗时，单位毫秒；无样本时为空。 */
  average_duration_ms: number | null;
  /** 当日 P95 执行耗时，单位毫秒；无样本时为空。 */
  p95_duration_ms: number | null;
  /** 当日已入账 Charge 数量。 */
  charge_count: number;
}

/** Admin Usage Overview 响应。 */
export interface AdminUsageOverviewResponse {
  /** 查询使用的 IANA 时区。 */
  timezone: string;
  /** 查询范围起始当地自然日，包含。 */
  from: string;
  /** 查询范围结束当地自然日，包含。 */
  to: string;
  /** 活跃用户核心指标。 */
  activity: AdminUsageActivityMetrics;
  /** 查询范围内全部用户的合计 Usage。 */
  summary: AdminUserUsageItem;
  /** 查询范围内的每日趋势。 */
  days: AdminUsageDay[];
  /** 模型维度调用、Token 与耗时聚合。 */
  models: AdminAIUsageDimensionBucket[];
  /** Action 维度调用、Token 与耗时聚合。 */
  actions: AdminAIUsageDimensionBucket[];
  /** 当地 0–23 点活跃分布。 */
  hours: AdminAIHourlyUsageBucket[];
  /** 全局执行耗时与计量可靠性摘要。 */
  performance: AdminAIPerformanceMetrics;
}

/** Admin 单日注册用户趋势点。 */
export interface AdminRegistrationDay {
  /** 当地自然日，格式为 YYYY-MM-DD。 */
  date: string;
  /** 当日新增注册用户数。 */
  new_user_count: number;
}

/** 注册 Cohort 在固定日期上的留存率。 */
export interface AdminRetentionRates {
  /** 次日留存率；尚未到观察日时为空。 */
  day_1: number | null;
  /** 3 日留存率；尚未到观察日时为空。 */
  day_3: number | null;
  /** 7 日留存率；尚未到观察日时为空。 */
  day_7: number | null;
  /** 14 日留存率；尚未到观察日时为空。 */
  day_14: number | null;
  /** 30 日留存率；尚未到观察日时为空。 */
  day_30: number | null;
}

/** Admin 单个注册 Cohort 留存数据。 */
export interface AdminRetentionCohort {
  /** 注册 Cohort 当地自然日。 */
  date: string;
  /** 当日注册用户数。 */
  new_user_count: number;
  /** 固定观察日留存率。 */
  rates: AdminRetentionRates;
}

/** Admin 注册与 Usage 留存分析响应。 */
export interface AdminUsageRetentionResponse {
  /** 查询使用的 IANA 时区。 */
  timezone: string;
  /** 查询范围起始当地自然日，包含。 */
  from: string;
  /** 查询范围结束当地自然日，包含。 */
  to: string;
  /** 当前 Federation 注册用户总量。 */
  total_registered_users: number;
  /** 查询范围内每日新增注册用户趋势。 */
  registration_days: AdminRegistrationDay[];
  /** 按注册日期升序排列的 Cohort 留存。 */
  cohorts: AdminRetentionCohort[];
  /** 各固定观察日按用户加权后的平均留存率。 */
  average_rates: AdminRetentionRates;
}

/** Admin 按用户 Usage 列表响应。 */
export interface AdminUsageUsersResponse {
  /** 查询使用的 IANA 时区。 */
  timezone: string;
  /** 查询范围起始当地自然日，包含。 */
  from: string;
  /** 查询范围结束当地自然日，包含。 */
  to: string;
  /** 按调用次数和用户 ID 稳定排序的用户 Usage。 */
  items: AdminUserUsageItem[];
}
