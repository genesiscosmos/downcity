/**
 * 模型与工具执行的临时状态通知。
 *
 * 每次进入执行器时发布 running，并在 finally 发布 idle；子工作等待不属于执行段。
 * 通知只供实时副作用使用，不进入完成日志，也不重放。失败隔离不改变执行结果。
 */
import { SESSION_HOOK_POINTS, type SessionExecutionStateHookValue, type JsonValue } from "@downcity/type";
import type { SessionTurnContext } from "@/types/turn/SessionTurnContext.js";
import type { SessionTurnCompletionOptions } from "@/types/session/SessionTurnCompletion.js";
import { run_effect_point } from "@/session/input/SessionHookRunner.js";

/** 在一次执行器调用前后通知扩展，所有退出路径都发布 idle。 */
export async function with_session_execution_state<T>(
  options: Pick<SessionTurnCompletionOptions, "session_id" | "get_hooks" | "create_call_context">,
  turn_context: SessionTurnContext,
  execute: () => Promise<T>,
): Promise<T> {
  const hooks = options.get_hooks();
  if (!hooks.effect[SESSION_HOOK_POINTS.execution_state]?.length) return await execute();
  const notify = async (state: SessionExecutionStateHookValue["state"]): Promise<void> => {
    try {
      const value: SessionExecutionStateHookValue = {
        session_id: options.session_id,
        turn_id: turn_context.session.turn_id,
        state,
      };
      await run_effect_point({
        hooks,
        point_name: SESSION_HOOK_POINTS.execution_state,
        value: value as unknown as JsonValue,
        context: options.create_call_context({
          turn_id: turn_context.session.turn_id,
          abort_signal: turn_context.lifecycle.abort_signal,
        }),
      });
    } catch {
      // 临时通知不承担持久化责任，不能改变模型或工具的执行结果。
    }
  };
  try {
    await notify("running");
    return await execute();
  } finally {
    await notify("idle");
  }
}
