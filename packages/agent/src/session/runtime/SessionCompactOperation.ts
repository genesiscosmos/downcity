/**
 * Session 显式压缩操作生命周期。
 *
 * 该模块只负责把队列 Command 的异步执行映射为公开 Compact Handle；压缩计划、
 * canonical 历史提交与事件发布仍由 Session 领域拥有。
 */

import type {
  AgentSessionCompactHandle,
  AgentSessionCompactResult,
} from "@/types/sdk/AgentSessionCompact.js";
import type { SessionCompactHistory } from "@/types/session/SessionExecution.js";

/** 创建显式压缩操作所需的领域回调。 */
export interface CreateSessionCompactOperationOptions {
  /** 当前显式压缩请求的稳定标识。 */
  compact_id: string;
  /** 在 Session Queue 检查点执行统一历史压缩。 */
  run: () => ReturnType<SessionCompactHistory>;
  /** 发布最终 Compact Mutation；观测失败不能改变结果。 */
  publish_finish: (result: AgentSessionCompactResult) => void;
  /** 尽力记录未被压缩领域入口吸收的异常。 */
  log_error: (error_message: string) => Promise<void>;
}

/** 显式压缩操作暴露给 Session Queue 的内部能力。 */
export interface SessionCompactOperation {
  /** 立即返回给 SDK 调用方的等待句柄。 */
  handle: AgentSessionCompactHandle;
  /** 由排队的 Session Command 调用并负责最终兑现句柄。 */
  execute: () => Promise<void>;
}

/** 创建一个与单次 Session Compact Command 绑定的操作生命周期。 */
export function create_session_compact_operation(
  options: CreateSessionCompactOperationOptions,
): SessionCompactOperation {
  let result: AgentSessionCompactResult | null = null;
  let resolve_finished!: (value: AgentSessionCompactResult) => void;
  const finished = new Promise<AgentSessionCompactResult>((resolve) => {
    resolve_finished = resolve;
  });

  return {
    handle: {
      id: options.compact_id,
      get result() {
        return result;
      },
      finished,
    },
    execute: async () => {
      let final_result: AgentSessionCompactResult;
      try {
        const outcome = await options.run();
        const reason = outcome.compacted
          ? "compacted"
          : outcome.reason === "nothing_to_compact"
            ? "nothing_to_compact"
            : "compact_failed";
        final_result = {
          compact_id: options.compact_id,
          success: reason !== "compact_failed",
          compacted: outcome.compacted,
          reason,
          ...(outcome.error ? { error: outcome.error } : {}),
        };
      } catch (error) {
        const error_message = error instanceof Error ? error.message : String(error);
        final_result = {
          compact_id: options.compact_id,
          success: false,
          compacted: false,
          reason: "compact_failed",
          error: error_message,
        };
        try {
          await options.log_error(error_message);
        } catch {
          // 关键点（中文）：日志属于观测侧，失败不能阻止 Handle 收口。
        }
      }

      result = final_result;
      try {
        options.publish_finish(final_result);
      } catch {
        // 关键点（中文）：事件发布失败不能让已完成的 Command 反向失败。
      }
      resolve_finished(final_result);
    },
  };
}
