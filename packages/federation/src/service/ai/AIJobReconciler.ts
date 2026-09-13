/**
 * AI 异步任务恢复协调器。
 *
 * 职责（中文）
 * - 从事实源（`async_jobs`、`ai_settlement_jobs`）重新推进失去触发器的任务：
 *   重新入队停滞的图片任务、处理到期的结算任务。
 * - 承担周期驱动：长期运行宿主由 SDK 自驱动（恢复动作执行完再排下一次）；
 *   请求级运行时由部署契约（cron / scheduled handler）调用同一个动作。
 *
 * 关键点（中文）
 * - 恢复是兜底而不是主路径。正常路径仍由任务自身的 `poll_after_ms` /
 *   `next_attempt_at` 驱动；恢复只接管已经停滞的那些，避免每个周期重复打上游。
 * - 周期驱动复用 Federation 异步调度能力，因此不需要新增进程级生命周期钩子：
 *   `Federation.dispose()` 关闭调度器时，未触发的恢复消息会被一并清理。
 * - 续排放在 `finally`：单次恢复失败（数据库抖动等）不能把恢复循环本身打断；
 *   但失败仍向上抛出，由调度层（in-process 上报或部署侧日志）记录，不静默吞掉。
 */

import type { Context } from "../service.js";
import type {
  AIJobReconcileResult,
  AIJobReconcilerDeps,
  AIJobReconcilerOptions,
} from "../../types/AIJobReconciler.js";
import { normalizePositiveNumber } from "./ai-service-values.js";

/** 恢复动作 ID；部署侧 cron / scheduled handler 使用同一个 ID 触发。 */
export const JOB_RESUME_ACTION = "jobs/resume";
/** 默认恢复周期：30 秒。 */
const DEFAULT_RECONCILE_INTERVAL_MS = 30_000;
/** 默认单次重新入队的图片任务上限。 */
const DEFAULT_RESUME_LIMIT = 20;

/** AI 异步任务恢复协调器；实例生命周期跟随 AIService。 */
export class AIJobReconciler {
  /** 自驱动恢复循环的周期毫秒数。 */
  private readonly interval_ms: number;
  /** 单次恢复最多重新入队的图片任务数。 */
  private readonly resume_limit: number;

  constructor(
    private readonly deps: AIJobReconcilerDeps,
    options: AIJobReconcilerOptions = {},
  ) {
    this.interval_ms = normalizePositiveNumber(
      options.interval_ms,
      DEFAULT_RECONCILE_INTERVAL_MS,
    );
    this.resume_limit = normalizePositiveNumber(
      options.resume_limit,
      DEFAULT_RESUME_LIMIT,
    );
  }

  /**
   * 执行一次恢复。
   *
   * 说明（中文）
   * - `loop` 为真表示本次是由 SDK 自驱动循环触发的，结束后需要续排下一次；
   *   由 cron / scheduled handler 触发的恢复不续排，避免与部署侧调度重复。
   * - 恢复失败会向上抛出（可观察），续排仍会在 `finally` 中完成。
   */
  async run(ctx: Context, options: { loop: boolean }): Promise<AIJobReconcileResult> {
    try {
      const recovered_settlements = await this.deps.recover_due_settlements(this.resume_limit);
      const resumed_image_jobs = await this.deps.resume_stalled_image_jobs(ctx, {
        resume_limit: this.resume_limit,
        stalled_after_ms: this.interval_ms,
      });
      return { resumed_image_jobs, recovered_settlements };
    } finally {
      if (options.loop) await this.schedule_next();
    }
  }

  /**
   * 引导周期恢复循环。
   *
   * 关键点（中文）
   * - 只在长期运行宿主（`in_process`）自驱动：那里 SDK 真正拥有跨请求存活的调度器。
   * - 请求级运行时的周期恢复属于部署契约（cron / scheduled handler），
   *   这里既不隐式改用定时器，也不假装已经启动。
   * - 引导失败不影响 Federation 启动：恢复是兜底能力，失败只上报，交由运维可见。
   */
  async start(): Promise<void> {
    const queue = this.deps.get_queue();
    if (!queue) return;
    if (queue.state !== "in_process") {
      if (queue.state === "unavailable") {
        console.warn(
          "[AIService] job recovery loop not started: async dispatch capability is unavailable",
        );
      }
      return;
    }
    try {
      await queue.send({
        service: "ai",
        action: JOB_RESUME_ACTION,
        input: { loop: true },
        delay_ms: 0,
      });
    } catch (error) {
      console.warn(
        `[AIService] job recovery loop bootstrap failed :: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * 排下一次恢复。
   *
   * 关键点（中文）
   * - 续排失败只上报：能力不可用或调度器已释放时，恢复循环自然停止，
   *   由部署侧调度或下一次进程启动兜底，不产生未处理的 Promise 拒绝。
   */
  private async schedule_next(): Promise<void> {
    try {
      const queue = this.deps.get_queue();
      if (!queue) return;
      queue.require_available();
      await queue.send({
        service: "ai",
        action: JOB_RESUME_ACTION,
        input: { loop: true },
        delay_ms: this.interval_ms,
      });
    } catch (error) {
      console.warn(
        `[AIService] job recovery loop stopped :: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
