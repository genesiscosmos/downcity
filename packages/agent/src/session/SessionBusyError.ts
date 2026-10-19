/** Session 独占提交的业务错误；调用方可以稍后重试或创建另一条工作会话。 */
export class SessionBusyError extends Error {
  /** 稳定错误码，可用于 Tool 和宿主返回 busy 状态。 */
  readonly code = "session_busy";
  /** 被占用的 Session 稳定标识。 */
  readonly session_id: string;

  constructor(session_id: string) {
    super(`Session is busy: ${session_id}`);
    this.name = "SessionBusyError";
    this.session_id = session_id;
  }
}
