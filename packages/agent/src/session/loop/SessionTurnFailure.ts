/**
 * 无法可靠提交的 Turn 失败收口。
 *
 * 不补写业务消息、不提交未知结果；先释放资源，再以完整异常链拒绝句柄。
 * 诊断仅输出白名单异常树，日志自身失败不改变 Turn 结算。
 */
import { SessionFailure } from "@/session/SessionFailure.js";
import { safe_error_diagnostic } from "@/utils/logger/SafeErrorDiagnostic.js";
import type { ActiveSessionTurnState } from "@/types/session/SessionLoop.js";
import type { Logger } from "@/utils/logger/Logger.js";

/** 结束已经关闭接收的失败 Turn；调用者负责清除 active 引用和标记未知状态。 */
export async function reject_failed_session_turn(
  active: ActiveSessionTurnState,
  error: unknown,
  logger: Logger,
  session_id: string,
): Promise<void> {
  try { await active.turn_context?.lifecycle.dispose(); }
  catch (failure) { error = new SessionFailure("dispose_context", error, failure); }
  try {
    await logger.log("error", "Session Turn finalization failed", {
      session_id, turn_id: active.turn_id, exception: safe_error_diagnostic(error),
    });
  } catch { /* 日志不能覆盖原始失败或阻止句柄结算。 */ }
  active.deferred_finished.reject(error);
}
