/**
 * Session 控制面调用执行面的最小端口。
 *
 * SessionTurn 只依赖本接口，不了解 Executor、CoreEngine 或 AI SDK Adapter 的具体实现。
 */

import type { SessionRunInput, SessionRunResult } from "@/executor/types/SessionRun.js";
import type { SessionRunContext } from "@/types/executor/SessionRunContext.js";

/** SessionTurn 所需的完整执行能力。 */
export interface SessionExecutionPort {
  /** 执行一次模型与 Tool Loop。 */
  run(input: SessionRunInput): Promise<SessionRunResult>;
  /** 请求停止当前执行，返回是否命中活跃执行。 */
  stop(): boolean;
  /** 在 Assistant 收口后提交一次 canonical 历史压缩。 */
  compact_history(
    run_context: SessionRunContext,
    retry_count?: number,
  ): Promise<{
    /** 是否实际生成并提交了压缩计划。 */
    compacted: boolean;
    /** 未压缩时的稳定原因。 */
    reason?: string;
  }>;
}
