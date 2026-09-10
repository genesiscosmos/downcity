/**
 * ExecutorRecoveryPolicy：执行恢复与重试策略。
 *
 * 关键点（中文）
 * - 统一封装“压缩后重试”和“普通失败兜底”逻辑。
 * - Executor 提供单次 Turn 行为，本模块只决定是否恢复并重试。
 * - 不改变外部行为，只把异常分流规则集中到一个地方。
 */

import type { Logger } from "@/utils/logger/Logger.js";
import type { SessionTurnExecutionResult } from "@/types/session/SessionExecution.js";

/**
 * 可压缩错误的最大重试次数。
 */
const MAX_COMPACTION_RETRY_ATTEMPTS = 3;

interface ExecutorRecoveryPolicyOptions {
  /** 当前 Session 稳定标识。 */
  session_id: string;

  /** 请求 Composer 尝试推进上下文派生状态。 */
  recover_context: (error: unknown) => Promise<boolean>;

  /**
   * 当前 session 统一日志器。
   */
  logger: Logger;
}

interface ExecutorRecoveryInput {
  /** 按当前恢复次数执行完整 Turn。 */
  execute_turn: (retry_count: number) => Promise<SessionTurnExecutionResult>;
}

/**
 * 执行恢复与重试策略服务。
 */
export class ExecutorRecoveryPolicy {
  private readonly recover_context: ExecutorRecoveryPolicyOptions["recover_context"];
  private readonly logger: Logger;

  constructor(options: ExecutorRecoveryPolicyOptions) {
    const session_id = String(options.session_id || "").trim();
    this.recover_context = options.recover_context;
    this.logger = options.logger;
    if (!session_id) {
      throw new Error("ExecutorRecoveryPolicy requires a non-empty session_id");
    }
  }

  /**
   * 执行一次带恢复策略的 Session Turn。
   */
  async execute_with_retry(
    input: ExecutorRecoveryInput,
  ): Promise<SessionTurnExecutionResult> {
    let retry_count = 0;
    while (true) {
      try {
        return await input.execute_turn(retry_count);
      } catch (error) {
        if (retry_count < MAX_COMPACTION_RETRY_ATTEMPTS) {
          const recovered = await this.recover_context(error);
          if (recovered) {
            await this.logger.log("info", "[agent] compacting", {
              retryCount: retry_count,
              error: String(error),
            });
            retry_count += 1;
            continue;
          }
        }
        if (retry_count > 0) {
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
