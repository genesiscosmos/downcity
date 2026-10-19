/**
 * Turn 终态的写前日志边界。
 * 模型结果在关闭 canonical Assistant Message 前必须可恢复；日志故障不能降级为
 * 普通 best-effort Hook 错误。保存失败时拒绝 finished，保留可恢复的非终态历史。
 */
import type { SessionTurnCommittedHookValue } from "@downcity/type";
import type { SessionTurnCompletionOptions } from "@/types/session/SessionTurnCompletion.js";
import type { ActiveSessionTurnState } from "@/types/session/SessionLoop.js";
import type { AgentSessionTurnResult } from "@/types/sdk/AgentSessionTurn.js";

/** 标识终态不能确认的持久化故障，不允许以另一个成功结果覆盖。 */
export class CompletionPersistenceError extends Error {
  constructor(cause: unknown) {
    super("Session completion could not be persisted; execution is not acknowledged", { cause });
    this.name = "CompletionPersistenceError";
  }
}

/** 在用户可见终态之前保存结果，后续故障不会丢失已执行的工作结果。 */
export async function prepare_session_completion(
  options: SessionTurnCompletionOptions,
  active_turn: ActiveSessionTurnState,
  result: AgentSessionTurnResult,
): Promise<void> {
  if (!options.completions) return;
  const stopped = active_turn.turn_context?.lifecycle.abort_signal.aborted === true;
  const event: SessionTurnCommittedHookValue = {
    completion_id: `completion:${options.session_id}:${active_turn.turn_id}`,
    session_id: options.session_id,
    turn_id: active_turn.turn_id,
    status: stopped ? "stopped" : result.success ? "completed" : "failed",
    result: {
      text: result.text,
      success: stopped ? false : result.success,
      ...(stopped ? { error: options.stopped_message } : result.error ? { error: result.error } : {}),
    },
    messages: (await options.messages.list_history_messages())
      .filter((message) => message.turn_id === active_turn.turn_id)
      .map((message) => structuredClone(message)),
  };
  try {
    await options.completions.prepare(event, options.create_call_context({
      turn_id: active_turn.turn_id,
      abort_signal: active_turn.turn_context?.lifecycle.abort_signal ?? new AbortController().signal,
    }));
  } catch (error) {
    throw new CompletionPersistenceError(error);
  }
}
