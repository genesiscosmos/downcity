/**
 * AI 异步任务恢复协调器装配类型。
 *
 * 恢复协调器只依赖三个最小能力：读取异步调度能力、重新入队停滞的图片任务、
 * 推进到期的结算任务。它既不持有 AIService，也不认识具体存储实现。
 */

import type { Context } from "../service/service.js";
import type { FederationQueue } from "../federation/queue.js";

/** 重新入队停滞图片任务的参数。 */
export interface AIJobResumeOptions {
  /** 单次重新入队的任务数上限。 */
  resume_limit: number;
  /**
   * 停滞判定阈值（毫秒）。
   *
   * 距最后一次进展超过 `max(该值, 任务自身的 poll_after_ms)` 的非终态任务，
   * 才被认为触发器已经丢失、需要恢复流程接管。
   */
  stalled_after_ms: number;
}

/** 恢复协调器依赖的最小能力。 */
export interface AIJobReconcilerDeps {
  /** 读取当前 Federation 异步调度能力；未装配时返回 undefined。 */
  get_queue(): FederationQueue | undefined;
  /** 重新入队停滞的图片任务，返回真正入队的数量。 */
  resume_stalled_image_jobs(ctx: Context, options: AIJobResumeOptions): Promise<number>;
  /** 推进到期的可靠结算任务，返回推进数量。 */
  recover_due_settlements(limit: number): Promise<number>;
}

/** 恢复协调器可调参数。 */
export interface AIJobReconcilerOptions {
  /** 自驱动恢复循环的周期毫秒数；非法值使用内部默认值。 */
  interval_ms?: number;
  /** 单次恢复最多重新入队的图片任务数；非法值使用内部默认值。 */
  resume_limit?: number;
}

/** 一次恢复的结果。 */
export interface AIJobReconcileResult {
  /** 本次重新入队的停滞图片任务数。 */
  resumed_image_jobs: number;
  /** 本次推进的到期结算任务数。 */
  recovered_settlements: number;
}
