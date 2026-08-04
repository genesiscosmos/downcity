/**
 * 用户 Credits 与 AI 技术用量聚合契约。
 *
 * Credits 和 AI Usage 是独立事实，UsageService 只把两个 Reader 的每日结果
 * 合并成一个用户响应，不拥有事实副本。
 */

import type { AIUsageReader } from "@downcity/city";
import type { CreditsUsageReader } from "../../credits/types/Usage.js";

/** UsageService 显式 Reader 依赖。 */
export interface UsageServiceOptions {
  /** AIService 提供的技术用量只读接口。 */
  ai_usage_reader: AIUsageReader;
  /** CreditsService 提供的已入账消费只读接口。 */
  credits_usage_reader: CreditsUsageReader;
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
