/**
 * AI 图片任务并发存储模块。
 *
 * 通过 status + updated_at compare-and-set 保证同一任务同一时刻只有一个 worker
 * 查询上游、扣费和提交结果；超时的 fetching 租约允许后续 worker 接管。
 */

import type { CityTableApi } from "../../store/table-api.js";
import type { AIImageJobClaim, AIImageResult } from "../../types/AI.js";
import type { AsyncJobRecord } from "../../types/AsyncJob.js";

/** 单次图片抓取租约时长。 */
const IMAGE_FETCH_LEASE_MS = 5 * 60 * 1000;
/** 图片任务在通用任务表中的类型。 */
const IMAGE_GENERATE_JOB_TYPE = "ai.image.generate";

/**
 * 原子领取一个可执行的图片任务。
 *
 * 返回 null 表示任务正在被其他 worker 处理，或读取后的状态已不再可领取。
 */
export async function claim_image_job(
  table: CityTableApi,
  job: AsyncJobRecord,
): Promise<AIImageJobClaim | null> {
  if (job.status === "succeeded" || job.status === "failed") return null;
  if (job.status === "fetching" && !is_expired_claim(job.updated_at)) return null;
  if (job.status !== "queued" && job.status !== "running" && job.status !== "fetching") return null;

  const claimed_at = new Date().toISOString();
  const changed = await table.update({
    where: {
      job_id: job.job_id,
      job_type: IMAGE_GENERATE_JOB_TYPE,
      status: job.status,
      updated_at: job.updated_at,
    },
    values: {
      status: "fetching",
      updated_at: claimed_at,
    },
  });
  if (changed === 0) return null;
  return {
    claimed_at,
    record: {
      ...job,
      status: "fetching",
      updated_at: claimed_at,
    },
  };
}

/**
 * 当前 worker 失败时释放领取权，使队列重试可立即继续，而不必等待租约过期。
 */
export async function release_image_job_claim(
  table: CityTableApi,
  claim: AIImageJobClaim,
): Promise<void> {
  await table.update({
    where: claim_where(claim),
    values: {
      status: "running",
      updated_at: new Date().toISOString(),
    },
  });
}

/**
 * 由持有领取权的 worker 提交 Provider 抓取结果。
 */
export async function finish_image_job_fetch(
  table: CityTableApi,
  claim: AIImageJobClaim,
  output: AIImageResult,
): Promise<void> {
  const job = claim.record;
  const changed = await table.update({
    where: claim_where(claim),
    values: {
      status: output.status,
      state_json: JSON.stringify(output.metadata ?? parse_record_json(job.state_json)),
      result_json: output.result ? JSON.stringify(output.result) : job.result_json ?? null,
      error: output.error ?? null,
      message: output.message ?? null,
      poll_after_ms: output.poll_after_ms ? String(output.poll_after_ms) : null,
      updated_at: new Date().toISOString(),
    },
  });
  if (changed === 0) {
    throw new Error(`Image job lease lost: ${job.job_id}`);
  }
}

/** 构造只匹配当前 worker 租约的更新条件。 */
function claim_where(claim: AIImageJobClaim): Partial<AsyncJobRecord> {
  return {
    job_id: claim.record.job_id,
    job_type: IMAGE_GENERATE_JOB_TYPE,
    status: "fetching",
    updated_at: claim.claimed_at,
  };
}

/** 判断 fetching 租约是否已过期。 */
function is_expired_claim(updated_at: string): boolean {
  const claimed_at = Date.parse(updated_at);
  return !Number.isFinite(claimed_at) || Date.now() - claimed_at >= IMAGE_FETCH_LEASE_MS;
}

/** 安全读取任务状态元数据。 */
function parse_record_json(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
