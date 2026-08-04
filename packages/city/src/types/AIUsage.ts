/**
 * AI 技术用量与可靠结算类型。
 *
 * AI Usage 是模型执行产生的技术事实；Credits Charge 是独立账务事实。
 * 两者只通过 usage_id 关联，不能互相反推。
 */

import type { AICharge } from "./AI.js";

/** AI 最终计量是否可用于技术用量统计。 */
export type AIMeteringStatus = "settled" | "unavailable";

/** 一次 AI 执行的最终业务结果。 */
export type AIUsageOutcome = "succeeded" | "cancelled" | "failed";

/** AI 可靠结算任务状态。 */
export type AISettlementStatus = "pending" | "processing" | "retryable" | "completed" | "rejected";

/** AIService 持有的一次技术用量事实。 */
export interface AIUsageRecord extends Record<string, unknown> {
  /** 一次真实 AI 执行及其后续结算的稳定标识。 */
  usage_id: string;
  /** 当前调用所属用户；admin 调用没有用户时为空。 */
  user_id: string | null;
  /** 当前调用所属 Bureau；admin 调用没有 Bureau 时为空。 */
  bureau_id: string | null;
  /** AIService Action ID，例如 text、stream 或 image/fetch。 */
  action_id: string;
  /** Federation 对外模型 ID。 */
  model_id: string;
  /** AIChannel ID；无法解析时为空。 */
  channel_id: string | null;
  /** Provider 实际模型 ID；无法解析时为空。 */
  upstream_model: string | null;
  /** 最终计量是否完整可用。 */
  metering_status: AIMeteringStatus;
  /** AI 执行最终结果。 */
  outcome: AIUsageOutcome;
  /** 未命中缓存的输入 Token。 */
  uncached_input_tokens: number | null;
  /** 命中缓存的输入 Token。 */
  cached_input_tokens: number | null;
  /** 输出 Token。 */
  output_tokens: number | null;
  /** 输出 Token 中的推理 Token 子集。 */
  reasoning_tokens: number | null;
  /** 生成图片数量。 */
  image_count: number | null;
  /** 生成视频秒数。 */
  video_seconds: number | null;
  /** 生成或识别音频秒数。 */
  audio_seconds: number | null;
  /** 上游请求计量数量。 */
  request_count: number | null;
  /** 模型执行耗时毫秒数。 */
  duration_ms: number | null;
  /** AI 执行开始时间，UTC ISO 字符串。 */
  started_at: string;
  /** AI 执行或计量生命周期完成时间，UTC ISO 字符串。 */
  completed_at: string;
  /** 技术用量事实首次持久化时间，UTC ISO 字符串。 */
  created_at: string;
}

/** 持久化结算任务保存的安全负载。 */
export interface AISettlementPayload {
  /** 最终 AI Usage Record。 */
  record: AIUsageRecord;
  /** 已按完成时价格规则计算的账单草稿；为空表示免费调用。 */
  charge: AICharge | null;
}

/** 用户每日用量查询条件。 */
export interface UserDailyUsageQuery {
  /** Federation 内全局用户 ID。 */
  user_id: string;
  /** 查询时区中的起始自然日，包含。 */
  from: string;
  /** 查询时区中的结束自然日，包含。 */
  to: string;
  /** IANA 时区名称。 */
  timezone: string;
}

/** AI 每日聚合 Bucket。 */
export interface AIDailyUsageBucket {
  /** 当地自然日，格式为 YYYY-MM-DD。 */
  date: string;
  /** 当天全部 AI Usage Record 数量。 */
  execution_count: number;
  /** 当天 settled metering 中的上游请求数量。 */
  metered_request_count: number;
  /** 当天未命中缓存的输入 Token。 */
  uncached_input_tokens: number;
  /** 当天命中缓存的输入 Token。 */
  cached_input_tokens: number;
  /** 当天全部输入 Token。 */
  input_tokens: number;
  /** 当天输出 Token。 */
  output_tokens: number;
  /** 当天输出中的推理 Token 子集。 */
  reasoning_tokens: number;
  /** 当天输入与输出 Token 总量。 */
  total_tokens: number;
  /** 当天生成图片数量。 */
  image_count: number;
  /** 当天视频用量秒数。 */
  video_seconds: number;
  /** 当天音频用量秒数。 */
  audio_seconds: number;
}

/** AI 每日聚合结果。 */
export interface AIDailyUsageResult {
  /** 第一条 AI Usage Record 在查询时区中的日期。 */
  data_available_from: string | null;
  /** 按当地日期升序排列的稀疏 Bucket。 */
  days: AIDailyUsageBucket[];
}

/** UsageService 依赖的最小 AI Usage 只读接口。 */
export interface AIUsageReader {
  /** 按用户、当地日期范围与 IANA 时区聚合技术用量。 */
  aggregate_user_daily_usage(input: UserDailyUsageQuery): Promise<AIDailyUsageResult>;
}
