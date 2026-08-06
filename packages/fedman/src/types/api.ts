/** CLI 本地 BFF 暴露的 Federation 连接信息。 */
export interface FederationContext {
  /** 当前 Federation 的展示名称。 */
  federation_name: string;
  /** 当前 Federation 的公开服务地址。 */
  federation_url: string;
  /** registry 或当前会话中的管理员 ID。 */
  admin_id?: string;
  /** 本地 BFF 当前是否持有有效远端管理员 Session。 */
  authenticated: boolean;
  /** 当前管理员 Session 到期时间。 */
  expires_at?: string;
}

/** Fedman 管理员登录响应。 */
export interface FederationLoginResponse {
  /** 登录是否成功。 */
  authenticated: true;
  /** 当前管理员 ID。 */
  admin_id: string;
  /** 当前管理员 Session 到期时间。 */
  expires_at: string;
}

/** Usage Analytics 活跃指标。 */
export interface UsageActivityMetrics {
  /** 查询范围内产生过 Usage 的去重用户数。 */
  range_active_users: number;
  /** 查询结束日的去重活跃用户数。 */
  daily_active_users: number;
  /** 查询结束日滚动七天的去重活跃用户数。 */
  weekly_active_users: number;
  /** 查询结束日滚动三十天的去重活跃用户数。 */
  monthly_active_users: number;
  /** DAU 除以 MAU 的用户粘性；无 MAU 时为空。 */
  daily_monthly_stickiness: number | null;
}

/** Usage Analytics 总量指标。 */
export interface UsageSummary {
  /** AI 执行总次数。 */
  execution_count: number;
  /** 成功执行次数。 */
  succeeded_count: number;
  /** 失败执行次数。 */
  failed_count: number;
  /** 取消执行次数。 */
  cancelled_count: number;
  /** 成功执行占全部执行的比例。 */
  success_rate: number | null;
  /** 已完成 Metering 的上游请求数量。 */
  metered_request_count: number;
  /** 未命中缓存的输入 Token。 */
  uncached_input_tokens: number;
  /** 命中缓存的输入 Token。 */
  cached_input_tokens: number;
  /** 全部输入 Token。 */
  input_tokens: number;
  /** 全部输出 Token。 */
  output_tokens: number;
  /** 输出中的推理 Token 子集。 */
  reasoning_tokens: number;
  /** 输入与输出 Token 总量。 */
  total_tokens: number;
  /** 已入账 Credits 消耗。 */
  credits_used: number;
  /** 已入账 Charge 数量。 */
  charge_count: number;
}

/** 单日 Usage Analytics 指标。 */
export interface UsageDay extends UsageSummary {
  /** 查询时区中的当地自然日。 */
  date: string;
  /** 当日去重活跃用户数。 */
  active_user_count: number;
  /** 当日滚动七天去重活跃用户数。 */
  weekly_active_user_count: number;
  /** 当日滚动三十天去重活跃用户数。 */
  monthly_active_user_count: number;
  /** 当日 DAU 除以滚动 MAU。 */
  daily_monthly_stickiness: number | null;
  /** 当日 Metering 不可用次数。 */
  metering_unavailable_count: number;
  /** 当日有效样本的平均执行耗时。 */
  average_duration_ms: number | null;
  /** 当日有效样本的 P95 执行耗时。 */
  p95_duration_ms: number | null;
}

/** 模型或 Action 维度的 Usage 指标。 */
export interface UsageDimension {
  /** 模型 ID 或 Action ID。 */
  key: string;
  /** 当前维度的执行次数。 */
  execution_count: number;
  /** 当前维度的成功次数。 */
  succeeded_count: number;
  /** 当前维度的 Token 总量。 */
  total_tokens: number;
  /** 当前维度的平均执行耗时。 */
  average_duration_ms: number | null;
}

/** 当地小时活跃分布。 */
export interface UsageHour {
  /** 当地小时，范围为 0 至 23。 */
  hour: number;
  /** 该小时产生过 Usage 的去重用户数。 */
  active_user_count: number;
  /** 该小时的执行次数。 */
  execution_count: number;
}

/** 全局执行耗时与 Metering 质量摘要。 */
export interface UsagePerformance {
  /** 有效执行耗时样本数量。 */
  sample_count: number;
  /** 平均执行耗时。 */
  average_duration_ms: number | null;
  /** P50 执行耗时。 */
  p50_duration_ms: number | null;
  /** P95 执行耗时。 */
  p95_duration_ms: number | null;
  /** 最大执行耗时。 */
  max_duration_ms: number | null;
  /** Metering 不可用执行次数。 */
  metering_unavailable_count: number;
}

/** Usage Analytics 总览响应。 */
export interface UsageOverviewResponse {
  /** 查询使用的 IANA 时区。 */
  timezone: string;
  /** 查询起始当地自然日。 */
  from: string;
  /** 查询结束当地自然日。 */
  to: string;
  /** Federation 注册用户总量。 */
  total_registered_users: number;
  /** 查询范围内新增注册用户量。 */
  new_registered_users: number;
  /** 当前活跃指标。 */
  activity: UsageActivityMetrics;
  /** 查询范围总量指标。 */
  summary: UsageSummary;
  /** 按当地日期升序排列的趋势。 */
  days: UsageDay[];
  /** 当地小时活跃分布。 */
  hours: UsageHour[];
  /** 模型维度指标。 */
  models: UsageDimension[];
  /** Action 维度指标。 */
  actions: UsageDimension[];
  /** 全局性能指标。 */
  performance: UsagePerformance;
}

/** 单个 Federation 用户的 Usage 指标。 */
export interface UsageUser {
  /** Federation 内全局用户 ID。 */
  user_id: string;
  /** 用户认证邮箱；缺失时为空字符串。 */
  email: string;
  /** 查询范围内最后一次活跃时间。 */
  last_active_at: string;
  /** AI 执行次数。 */
  execution_count: number;
  /** 成功执行次数。 */
  succeeded_count: number;
  /** 失败执行次数。 */
  failed_count: number;
  /** 取消执行次数。 */
  cancelled_count: number;
  /** 成功执行占比。 */
  success_rate: number | null;
  /** Metering 完成的上游请求数量。 */
  metered_request_count: number;
  /** 全部输入 Token。 */
  input_tokens: number;
  /** 命中缓存的输入 Token。 */
  cached_input_tokens: number;
  /** 全部输出 Token。 */
  output_tokens: number;
  /** 输出中的推理 Token 子集。 */
  reasoning_tokens: number;
  /** 输入与输出 Token 总量。 */
  total_tokens: number;
  /** 已入账 Credits 消耗。 */
  credits_used: number;
  /** 已入账 Charge 数量。 */
  charge_count: number;
  /** 生成图片数量。 */
  image_count: number;
  /** 视频用量秒数。 */
  video_seconds: number;
  /** 音频用量秒数。 */
  audio_seconds: number;
  /** 调用次数最多的模型 ID。 */
  top_model_id: string;
  /** 有效样本平均执行耗时。 */
  average_duration_ms: number | null;
  /** 有效样本 P95 执行耗时。 */
  p95_duration_ms: number | null;
  /** Metering 不可用执行次数。 */
  metering_unavailable_count: number;
}

/** 按用户聚合的 Usage 响应。 */
export interface UsageUsersResponse {
  /** 查询使用的 IANA 时区。 */
  timezone: string;
  /** 查询起始当地自然日。 */
  from: string;
  /** 查询结束当地自然日。 */
  to: string;
  /** 全部注册用户及其 Usage 指标。 */
  items: UsageUser[];
}

/** 固定观察日留存率。 */
export interface RetentionRates {
  /** 注册后第 1 日留存率。 */
  day_1: number | null;
  /** 注册后第 3 日留存率。 */
  day_3: number | null;
  /** 注册后第 7 日留存率。 */
  day_7: number | null;
  /** 注册后第 14 日留存率。 */
  day_14: number | null;
  /** 注册后第 30 日留存率。 */
  day_30: number | null;
}

/** 单日新增注册用户。 */
export interface RegistrationDay {
  /** 注册当地自然日。 */
  date: string;
  /** 当日新增注册用户量。 */
  new_user_count: number;
}

/** 单个注册 Cohort 的留存。 */
export interface RetentionCohort {
  /** Cohort 注册当地自然日。 */
  date: string;
  /** Cohort 新增用户量。 */
  new_user_count: number;
  /** Cohort 固定观察日留存率。 */
  rates: RetentionRates;
}

/** 注册 Cohort 留存响应。 */
export interface RetentionResponse {
  /** 查询使用的 IANA 时区。 */
  timezone: string;
  /** 查询起始当地自然日。 */
  from: string;
  /** 查询结束当地自然日。 */
  to: string;
  /** Federation 注册用户总量。 */
  total_registered_users: number;
  /** 查询范围内每日新增用户趋势。 */
  registration_days: RegistrationDay[];
  /** 按注册日期排列的 Cohort。 */
  cohorts: RetentionCohort[];
  /** 按符合观察条件的用户加权后的平均留存。 */
  average_rates: RetentionRates;
}

/** 通用管理资源列表响应。 */
export interface ResourceListResponse {
  /** 管理资源记录；具体字段由远端 Service 定义。 */
  items: Array<Record<string, unknown>>;
}

/** CLI 本地动作响应。 */
export interface ActionResponse {
  /** 动作返回值。 */
  result: unknown;
}
