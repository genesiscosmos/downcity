/**
 * Session 当前进程的执行投影。阶段描述当前活动，生命周期保护覆盖尚未结束的 Turn。
 * 此协议不保存恢复输入或最终结果；Retry 能力只来自仍有效的内存绑定。
 */
import type { SessionModelRetry } from "./SessionModelRetry.js";

/** 当前执行阶段；闲置的可重试失败已完成原 Turn。 */
export type SessionRuntimeState = "idle" | "running" | "failed" | "waiting_input" | "waiting_child";

/** 快照、实时 Mutation 与宿主消费者共用的最小运行视图。 */
export interface SessionRuntimeSnapshot {
  /** 当前是否自主推进、等待用户/子工作，或显示已结束的可重试模型失败。 */
  state: SessionRuntimeState;
  /** 仍有接收、活 Turn 或收尾资源需要保护；可停止，禁止释放和自动派发新 Turn。 */
  live_execution: boolean;
  /** 当前未完成的 Turn 标识；无 Turn 的维护执行不携带此字段。 */
  active_turn_id?: string;
  /** 当前进程可操作的模型失败锚点；历史错误不提供此能力。 */
  model_retry?: SessionModelRetry;
}
