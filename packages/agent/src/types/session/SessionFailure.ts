/** Session 异常收尾使用的固定阶段；仅描述边界，不决定恢复策略。 */
export type SessionFailurePhase =
  | "abort_step" | "show_model_error" | "advance_context"
  | "cancel_children" | "flush_inputs" | "turn_finalize" | "dispose_context"
  | "prepare" | "execute" | "delivery" | "record_retry" | "retry_scan" | "cancel";
