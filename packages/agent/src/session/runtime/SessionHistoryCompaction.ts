/**
 * Session 历史压缩结果收口器。
 *
 * Session 仍提供 Composer 输入和 canonical 提交回调；本模块统一成功、空计划、
 * 失败与 best-effort 日志的结果映射，供显式压缩和自动恢复共同复用。
 */

import type { SessionCompactionPlan } from "@/types/session/SessionComposer.js";
import type { SessionCompactHistory } from "@/types/session/SessionExecution.js";

/** 执行一次历史压缩所需的 Session 领域回调。 */
export interface RunSessionHistoryCompactionOptions {
  /** 当前压缩所属 Turn；空值表示显式队列命令尚未进入 Turn。 */
  turn_id?: string;
  /** 让 Composer 基于只读 Session 快照生成压缩计划。 */
  create_plan: () => Promise<SessionCompactionPlan | null>;
  /** 原子提交 Composer 返回的 canonical 压缩计划。 */
  commit_plan: (plan: SessionCompactionPlan) => Promise<void>;
  /** 尽力记录压缩错误，不得覆盖领域结果。 */
  log_error: (error_message: string) => Promise<void>;
}

/** 执行并收口一次统一 Session 历史压缩。 */
export async function run_session_history_compaction(
  options: RunSessionHistoryCompactionOptions,
): ReturnType<SessionCompactHistory> {
  try {
    const plan = await options.create_plan();
    if (!plan) return { compacted: false, reason: "nothing_to_compact" };
    await options.commit_plan(plan);
    return { compacted: true };
  } catch (error) {
    const error_message = error instanceof Error ? error.message : String(error);
    try {
      await options.log_error(error_message);
    } catch {
      // 关键点（中文）：日志失败不能覆盖稳定的压缩领域结果。
    }
    return {
      compacted: false,
      reason: "compact_failed",
      error: error_message,
    };
  }
}
