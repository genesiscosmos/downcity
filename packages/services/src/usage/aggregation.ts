/** Credits 与 AI Usage 每日结果合并模块。 */

import type { AIDailyUsageResult } from "@downcity/city";
import type { CreditsDailyUsageResult } from "../credits/types/Usage.js";
import type { UserUsageBucket, UserUsageResponse } from "./types/Usage.js";

/** 合并两个事实所有者返回的每日 Bucket，并从每日数据生成 Summary。 */
export function merge_daily_usage(input: {
  timezone: string;
  from: string;
  to: string;
  credits_per_usd: number;
  ai: AIDailyUsageResult;
  credits: CreditsDailyUsageResult;
}): UserUsageResponse {
  const by_date = new Map<string, UserUsageResponse["days"][number]>();
  for (const row of input.ai.days) {
    const bucket = by_date.get(row.date) ?? { date: row.date, ...empty_usage_bucket() };
    bucket.ai = {
      execution_count: row.execution_count,
      metered_request_count: row.metered_request_count,
      uncached_input_tokens: row.uncached_input_tokens,
      cached_input_tokens: row.cached_input_tokens,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      reasoning_tokens: row.reasoning_tokens,
      total_tokens: row.total_tokens,
      image_count: row.image_count,
      video_seconds: row.video_seconds,
      audio_seconds: row.audio_seconds,
    };
    by_date.set(row.date, bucket);
  }
  for (const row of input.credits.days) {
    const bucket = by_date.get(row.date) ?? { date: row.date, ...empty_usage_bucket() };
    bucket.credits = { used: row.used, charge_count: row.charge_count };
    by_date.set(row.date, bucket);
  }
  const days = [...by_date.values()].sort((left, right) => left.date.localeCompare(right.date));
  const summary = days.reduce<UserUsageBucket>((total, day) => add_bucket(total, day), empty_usage_bucket());
  return {
    timezone: input.timezone,
    from: input.from,
    to: input.to,
    credits_per_usd: input.credits_per_usd,
    data_available_from: {
      credits: input.credits.data_available_from,
      ai: input.ai.data_available_from,
    },
    summary,
    days,
  };
}

/** 创建完整零值 Bucket。 */
export function empty_usage_bucket(): UserUsageBucket {
  return {
    credits: { used: 0, charge_count: 0 },
    ai: {
      execution_count: 0,
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
    },
  };
}

/** 安全累加一个每日 Bucket。 */
function add_bucket(total: UserUsageBucket, row: UserUsageBucket): UserUsageBucket {
  return {
    credits: {
      used: safe_add(total.credits.used, row.credits.used),
      charge_count: safe_add(total.credits.charge_count, row.credits.charge_count),
    },
    ai: {
      execution_count: safe_add(total.ai.execution_count, row.ai.execution_count),
      metered_request_count: safe_add(total.ai.metered_request_count, row.ai.metered_request_count),
      uncached_input_tokens: safe_add(total.ai.uncached_input_tokens, row.ai.uncached_input_tokens),
      cached_input_tokens: safe_add(total.ai.cached_input_tokens, row.ai.cached_input_tokens),
      input_tokens: safe_add(total.ai.input_tokens, row.ai.input_tokens),
      output_tokens: safe_add(total.ai.output_tokens, row.ai.output_tokens),
      reasoning_tokens: safe_add(total.ai.reasoning_tokens, row.ai.reasoning_tokens),
      total_tokens: safe_add(total.ai.total_tokens, row.ai.total_tokens),
      image_count: safe_add(total.ai.image_count, row.ai.image_count),
      video_seconds: safe_add(total.ai.video_seconds, row.ai.video_seconds),
      audio_seconds: safe_add(total.ai.audio_seconds, row.ai.audio_seconds),
    },
  };
}

/** 拒绝超出 JavaScript 安全整数范围的聚合结果。 */
function safe_add(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Usage aggregate exceeds safe integer range");
  return value;
}
