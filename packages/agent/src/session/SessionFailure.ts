/**
 * Session 原始失败与收尾失败的组合边界。
 *
 * cause 始终保留原始异常，secondary_error 保存收尾异常。该异常不继承模型失败，
 * 因而未可靠恢复的输出不会进入自动或手动模型重试。原异常只留在内存，日志必须脱敏。
 */
import type { SessionFailurePhase } from "@/types/session/SessionFailure.js";

/** 带原始异常和可选次级异常的失败关闭信号。 */
export class SessionFailure extends Error {
  /** 发生失败的固定执行或收尾阶段。 */
  readonly phase: SessionFailurePhase;
  /** 收尾阶段另外发生的异常；单阶段失败时省略。 */
  readonly secondary_error?: unknown;

  constructor(phase: SessionFailurePhase, cause: unknown, secondary_error?: unknown) {
    super(`session_failure:${phase}`, { cause });
    this.name = "SessionFailure";
    this.phase = phase;
    this.secondary_error = secondary_error;
  }
}

/** 执行必要收尾；失败时保留两项异常，并使调用者停止当前恢复流程。 */
export async function finish_failed_session_operation<TResult>(
  phase: SessionFailurePhase,
  original_error: unknown,
  finish: () => Promise<TResult> | TResult,
): Promise<TResult> {
  try { return await finish(); }
  catch (secondary_error) { throw new SessionFailure(phase, original_error, secondary_error); }
}
