/**
 * Session Turn 结果收口。
 *
 * 本模块统一结果映射、Turn Mutation、committed Hook 与 Context 释放顺序。它不消费
 * Queue，也不持有 Active Turn 引用或 Handle；这些调度状态仍由 SessionLoop 收口。
 */

import { nanoid } from "nanoid";
import type { JsonValue, SessionMessage } from "@downcity/type";
import type { AgentSessionTurnResult } from "@/types/sdk/AgentSessionTurn.js";
import type { SessionTurnExecutionResult } from "@/types/session/SessionExecution.js";
import type { ActiveSessionTurnState } from "@/types/session/SessionLoop.js";
import type { SessionTurnCompletionOptions } from "@/types/session/SessionTurnCompletion.js";
import type { SessionTurnCommittedHookValue } from "@downcity/type";
import { SESSION_HOOK_POINTS } from "@/session/SessionHookPoints.js";

/** 使用 Executor 结果完成当前 Turn。 */
export async function complete_session_turn(
  options: SessionTurnCompletionOptions,
  active_turn: ActiveSessionTurnState,
  result: SessionTurnExecutionResult,
): Promise<AgentSessionTurnResult> {
  const stopped = active_turn.turn_context?.lifecycle.abort_signal.aborted === true;
  const final_result: AgentSessionTurnResult = {
    turn_id: active_turn.turn_id,
    text: result.text,
    success: stopped ? false : result.success,
    ...(stopped
      ? { error: options.stopped_message }
      : result.error ? { error: result.error } : {}),
  };
  active_turn.result = final_result;
  options.events.publish({
    mutation_id: nanoid(),
    variant: "turn",
    type: "finish",
    session_id: options.session_id,
    turn_id: active_turn.turn_id,
    status: stopped ? "stopped" : final_result.success ? "completed" : "failed",
    created_at: Date.now(),
    text: final_result.text,
    ...(final_result.error ? { error: final_result.error } : {}),
  });
  await notify_turn_committed(
    options,
    active_turn,
    stopped ? "stopped" : final_result.success ? "completed" : "failed",
  );
  await dispose_turn_context(options, active_turn);
  return final_result;
}

/** 使用稳定失败结果结束当前 Turn。 */
export async function fail_session_turn(
  options: SessionTurnCompletionOptions,
  active_turn: ActiveSessionTurnState,
  error: unknown,
): Promise<AgentSessionTurnResult> {
  if (active_turn.result) return active_turn.result;
  const stopped = active_turn.turn_context?.lifecycle.abort_signal.aborted === true;
  const message = stopped
    ? options.stopped_message
    : error instanceof Error ? error.message : String(error);
  const final_result: AgentSessionTurnResult = {
    turn_id: active_turn.turn_id,
    text: "",
    success: false,
    error: message,
  };
  active_turn.result = final_result;
  if (message !== options.stopped_message) {
    try {
      await options.messages.append_error_part({
        scope: "turn",
        turn_id: active_turn.turn_id,
        code: "turn_execution_failed",
        message,
        recoverable: true,
      });
    } catch {
      // Error Part 兜底写入失败不能阻止 Turn Handle 收口。
    }
  }
  options.events.publish({
    mutation_id: nanoid(),
    variant: "turn",
    type: "finish",
    session_id: options.session_id,
    turn_id: active_turn.turn_id,
    status: stopped ? "stopped" : "failed",
    created_at: Date.now(),
    text: "",
    error: message,
  });
  await notify_turn_committed(options, active_turn, stopped ? "stopped" : "failed");
  await dispose_turn_context(options, active_turn);
  return final_result;
}

/** 在释放当前 Hook lease 前触发 Turn committed effect。 */
async function notify_turn_committed(
  options: SessionTurnCompletionOptions,
  active_turn: ActiveSessionTurnState,
  status: SessionTurnCommittedHookValue["status"],
): Promise<void> {
  const hooks = active_turn.turn_context?.step.hooks;
  if (!hooks) return;
  try {
    const messages = (await options.messages.list_history_messages())
      .filter((message) => message.turn_id === active_turn.turn_id)
      .map((message) => structuredClone(message));
    const value: SessionTurnCommittedHookValue = {
      session_id: options.session_id,
      turn_id: active_turn.turn_id,
      status,
      messages: messages as SessionMessage[],
    };
    await hooks.effect(
      SESSION_HOOK_POINTS.turn_committed,
      value as unknown as JsonValue,
    );
  } catch (error) {
    await log_turn_warning(options, active_turn, "session power effect failed", error, {
      point_name: SESSION_HOOK_POINTS.turn_committed,
    });
  }
}

/** 尽力释放当前 Turn 唯一拥有的 Context。 */
async function dispose_turn_context(
  options: SessionTurnCompletionOptions,
  active_turn: ActiveSessionTurnState,
): Promise<void> {
  try {
    await active_turn.turn_context?.lifecycle.dispose();
  } catch (error) {
    await log_turn_warning(options, active_turn, "turn context disposal failed", error);
  }
}

/** Turn 已经确定结果后使用的 best-effort 日志入口。 */
async function log_turn_warning(
  options: SessionTurnCompletionOptions,
  active_turn: ActiveSessionTurnState,
  message: string,
  error: unknown,
  detail: Record<string, string> = {},
): Promise<void> {
  try {
    await options.logger.log("warn", `[agent] ${message}`, {
      session_id: options.session_id,
      turn_id: active_turn.turn_id,
      ...detail,
      error: error instanceof Error ? error.message : String(error),
    });
  } catch {
    // Turn 结果已经确定，日志失败不能阻止 Handle 收口。
  }
}
