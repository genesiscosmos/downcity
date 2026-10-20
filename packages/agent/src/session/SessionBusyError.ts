/** 普通输入来自不同占用对象时的结构化业务错误。 */
import type { SessionPromptActor } from "@/types/sdk/SessionPromptActor.js";
export class SessionBusyError extends Error {
  /** 稳定错误码，可用于 Tool 和宿主返回 busy 状态。 */
  readonly code = "session_busy";
  /** 被占用的 Session 稳定标识。 */
  readonly session_id: string;

  /** 当前占用对象快照，供可信宿主解释冲突。 */
  readonly occupied_by?: SessionPromptActor;
  /** 被占用的 Turn；首条接收尚未建立 Turn 时为空。 */
  readonly turn_id?: string;

  constructor(session_id: string, occupied_by?: SessionPromptActor, turn_id?: string) {
    super(`Session is busy: ${session_id}`);
    this.name = "SessionBusyError";
    this.session_id = session_id;
    this.occupied_by = occupied_by ? structuredClone(occupied_by) : undefined;
    this.turn_id = turn_id;
  }
}
