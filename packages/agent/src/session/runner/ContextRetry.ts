/**
 * ContextRetry：推进上下文后重试整轮 Turn 的策略。
 *
 * 关键点（中文）
 * - 统一封装「推进上下文后重试」和「普通失败兜底」逻辑。
 * - 执行器提供单次 Turn 行为，本模块只决定是否恢复并重试。
 * - 模型步骤与外层兜底共用同一推进预算；步骤无法推进时正常失败结束。
 */

import type { Logger } from "@/utils/logger/Logger.js";
import { ResultSaveFailure } from "@/model/results/ResultSaveFailure.js";
import type { SessionTurnExecutionResult } from "@/types/session/SessionExecution.js";

/**
 * 上下文推进后的最大重试次数。
 */
const MAX_CONTEXT_ADVANCE_ATTEMPTS = 3;

/** 上下文已可靠推进；回到 Turn 检查点读取新输入，不重复消耗推进预算。 */
export class ModelContextAdvanced extends Error {}

interface ContextRetryOptions {
  /** 当前 Session 稳定标识。 */
  session_id: string;

  /** 请求 Composer 尝试推进上下文派生状态。 */
  advance_context: (error: unknown, signal?: AbortSignal) => Promise<boolean>;

  /**
   * 当前 session 统一日志器。
   */
  logger: Logger;
}

interface ContextRetryInput {
  /** 已使用的上下文预算，人工继续不重置。 */
  checkpoint?: import("@/types/session/SessionModelInput.js").SessionStepCheckpoint;
  /** 当前 Turn 取消后停止摘要恢复。 */
  signal?: AbortSignal;
  /** 按当前推进次数执行 Turn；模型步骤可先尝试有界推进，耗尽后失败结束。 */
  execute_turn: (advance_count: number, advance_context: (error: unknown) => Promise<boolean>) => Promise<SessionTurnExecutionResult>;
}

/**
 * 执行恢复与重试策略服务。
 */
export class ContextRetry {
  private readonly advance_context: ContextRetryOptions["advance_context"];
  private readonly logger: Logger;

  constructor(options: ContextRetryOptions) {
    const session_id = String(options.session_id || "").trim();
    this.advance_context = options.advance_context;
    this.logger = options.logger;
    if (!session_id) {
      throw new Error("ContextRetry requires a non-empty session_id");
    }
  }

  /**
   * 执行一次带恢复策略的 Session Turn。
   */
  async execute_with_retry(
    input: ContextRetryInput,
  ): Promise<SessionTurnExecutionResult> {
    let advance_count = input.checkpoint?.advance_count ?? 0;
    const advance_context = async (error: unknown): Promise<boolean> => {
      if (advance_count >= MAX_CONTEXT_ADVANCE_ATTEMPTS) return false;
      input.signal?.throwIfAborted();
      if (!await this.advance_context(error, input.signal)) return false;
      await this.logger.log("info", "[agent] context.advance", { advanceCount: advance_count, error: String(error) });
      advance_count += 1;
      if (input.checkpoint) input.checkpoint.advance_count = advance_count;
      return true;
    };
    while (true) {
      try {
        return await input.execute_turn(advance_count, advance_context);
      } catch (error) {
        // 操作已发生，任何 Composer 推进建议都不能授权重新执行。
        if (error instanceof ResultSaveFailure) return this.build_failure_result({ error_text: error.message });
        if (error instanceof ModelContextAdvanced || await advance_context(error)) continue;
        if (advance_count > 0) {
          return this.build_failure_result({
            error_text:
              "Context length exceeded and retries failed. Please resend your question.",
          });
        }

        const error_text = String(error);
        await this.logger.log("error", "Executor execution failed", {
          error: error_text,
        });
        return this.build_failure_result({
          error_text,
        });
      }
    }
  }

  private build_failure_result(input: {
    /**
     * 对外暴露的错误文本。
     */
    error_text: string;

  }): SessionTurnExecutionResult {
    return {
      success: false,
      text: "",
      error: input.error_text,
    };
  }
}
