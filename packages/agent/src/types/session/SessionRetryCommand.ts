/** SessionRetryCommand 的窄依赖契约；字段只表达命令执行所需能力。 */
import type { SessionModelReplay } from "@/types/session/SessionModelInput.js";
import type { ActiveSessionTurnState } from "@/types/session/SessionLoop.js";
import type { SessionTurnExecutionResult } from "@/types/session/SessionExecution.js";
import type { SessionTurnCompletionOptions } from "@/types/session/SessionTurnCompletion.js";

/** 新 Retry 命令借用的执行所有者能力；不拥有旧执行。 */
export interface SessionRetryCommandOptions {
  /** 尚未开始就被 Stop 取消时释放占用并结算这次方法调用。 */
  cancel: () => void;
  /** 只驻留当前进程的失败请求。 */
  replay: SessionModelReplay;
  /** 读取 Loop 为原 Turn 创建的本次调用状态。 */
  active: () => ActiveSessionTurnState;
  /** 继续原 Turn，首步使用描述中的相同 ModelCall。 */
  execute: (active: ActiveSessionTurnState) => Promise<SessionTurnExecutionResult>;
  /** 本次调用的唯一完成依赖。 */
  completion: SessionTurnCompletionOptions;
  /** Loop 在完成后释放本次引用；不改写旧调用结果。 */
  release: (active: ActiveSessionTurnState) => void;
}
