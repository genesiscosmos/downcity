/**
 * ExecutorRecoveryPolicy：执行恢复与重试策略。
 *
 * 关键点（中文）
 * - 统一封装“压缩后重试”和“普通失败兜底”逻辑。
 * - Executor 只负责准备输入与调用策略，不再直接承载重试状态机。
 * - 不改变外部行为，只把异常分流规则集中到一个地方。
 */

import type { LanguageModel } from "ai";
import type { Logger } from "@/utils/logger/Logger.js";
import type { SessionTurnContext } from "@/types/executor/SessionTurnContext.js";
import type {
  SessionStepExecutionInput,
  SessionTurnExecutionResult,
} from "@/types/session/SessionExecution.js";

/**
 * 可压缩错误的最大重试次数。
 */
const MAX_COMPACTION_RETRY_ATTEMPTS = 3;

interface ExecutorRecoveryPolicyOptions {
  /** 当前 Session 稳定标识。 */
  session_id: string;

  /** 判断错误是否需要持久化压缩后重试。 */
  should_compact: (error: unknown) => boolean;

  /**
   * 当前 session 统一日志器。
   */
  logger: Logger;
}

interface ExecutorPrepareExecutionInput {
  /**
   * 当前轮用户 query。
   */
  query: string;

  /**
   * 当前轮模型实例。
   */
  model: LanguageModel;

  /**
   * 当前显式运行上下文。
   */
  turn_context: SessionTurnContext;

  /**
   * 当前压缩重试次数。
   */
  retry_count: number;
}

interface ExecutorExecutePreparedInput {
  /**
   * 已装配好的执行输入。
   */
  execute_input: SessionStepExecutionInput;

  /**
   * 当前轮模型实例。
   */
  model: LanguageModel;

  /**
   * 当前显式运行上下文。
   */
  turn_context: SessionTurnContext;
}

interface ExecutorRecoveryInput {
  /**
   * 当前轮用户 query。
   */
  query: string;

  /**
   * 当前轮模型实例。
   */
  model: LanguageModel;

  /**
   * 当前显式运行上下文。
   */
  turn_context: SessionTurnContext;

  /**
   * 运行前装配执行输入。
   */
  prepare_execute_input: (
    input: ExecutorPrepareExecutionInput,
  ) => Promise<SessionStepExecutionInput>;

  /**
   * 执行已装配好的运行输入。
   */
  execute_prepared_input: (
    input: ExecutorExecutePreparedInput,
  ) => Promise<SessionTurnExecutionResult>;
}

/**
 * 执行恢复与重试策略服务。
 */
export class ExecutorRecoveryPolicy {
  private readonly should_compact: ExecutorRecoveryPolicyOptions["should_compact"];
  private readonly logger: Logger;
  private retry_count = 0;

  constructor(options: ExecutorRecoveryPolicyOptions) {
    const session_id = String(options.session_id || "").trim();
    this.should_compact = options.should_compact;
    this.logger = options.logger;
    if (!session_id) {
      throw new Error("ExecutorRecoveryPolicy requires a non-empty session_id");
    }
  }

  /**
   * 重置当前 Turn 执行状态。
   */
  reset_execution_state(): void {
    this.retry_count = 0;
  }

  /**
   * 执行一次带恢复策略的 Session Turn。
   */
  async execute_with_retry(
    input: ExecutorRecoveryInput,
  ): Promise<SessionTurnExecutionResult> {
    try {
      const execute_input = await input.prepare_execute_input({
        query: input.query,
        model: input.model,
        turn_context: input.turn_context,
        retry_count: this.retry_count,
      });
      return await input.execute_prepared_input({
        execute_input,
        model: input.model,
        turn_context: input.turn_context,
      });
    } catch (error) {
      if (this.should_compact(error)) {
        await this.logger.log("info", "[agent] compacting", {
          retryCount: this.retry_count,
          error: String(error),
        });

        if (this.retry_count < MAX_COMPACTION_RETRY_ATTEMPTS) {
          this.retry_count += 1;
          return await this.execute_with_retry(input);
        }

        return this.build_failure_result({
          error_text:
            "Context length exceeded and retries failed. Please resend your question.",
          turn_context: input.turn_context,
        });
      }

      const error_text = String(error);
      await this.logger.log("error", "Executor execution failed", {
        error: error_text,
      });
      return this.build_failure_result({
        error_text,
        turn_context: input.turn_context,
      });
    }
  }

  private build_failure_result(input: {
    /**
     * 对外暴露的错误文本。
     */
    error_text: string;

    /**
     * 当前显式运行上下文。
     */
    turn_context: SessionTurnContext;
  }): SessionTurnExecutionResult {
    return {
      success: false,
      text: "",
      error: input.error_text,
      deferred_persisted_user_messages: [
        ...input.turn_context.input.deferred_user_messages(),
      ],
    };
  }
}
