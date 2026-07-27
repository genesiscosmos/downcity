/**
 * SessionTurn 构造参数与内部运行态类型。
 *
 * 这些类型描述 Turn 编排所依赖的领域对象，不实现任何调度行为。
 */

import type { ShellApprovalGateway } from "@downcity/shell";
import type { SessionEventHub } from "@/session/runtime/SessionEventHub.js";
import type { SessionMessages } from "@/session/SessionMessages.js";
import type { SessionState } from "@/session/SessionState.js";
import type { AgentSessionTurnResult } from "@/types/sdk/AgentSessionTurn.js";
import type { SessionQueueCommand } from "@/types/session/SessionQueue.js";
import type { SessionInteractionLifecycle } from "@/types/session/SessionInteraction.js";
import type { SessionExecutionPort } from "@/types/session/SessionExecution.js";

/** Promise 延迟控制器。 */
export interface SessionDeferred<T> {
  /** 等待兑现的 Promise。 */
  promise: Promise<T>;
  /** 兑现 Promise 的函数。 */
  resolve: (value: T) => void;
}

/** 当前活跃 Turn 的内存状态。 */
export interface ActiveSessionTurnState {
  /** 当前 Turn 的稳定标识。 */
  turn_id: string;
  /** 当前 Turn 的最终结果快照。 */
  result: AgentSessionTurnResult | null;
  /** 当前 Turn 完成状态的延迟控制器。 */
  deferred_finished: SessionDeferred<AgentSessionTurnResult>;
  /** 当前 Turn 的取消控制器。 */
  abort_controller: AbortController;
}

/** SessionTurn 构造参数。 */
export interface SessionTurnOptions {
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Session 所属 Workspace 的绝对根目录。 */
  workspace_path: string;
  /** 当前 Session 的模型执行器。 */
  executor: SessionExecutionPort;
  /** 当前 Session 的配置与 Metadata 状态。 */
  state: SessionState;
  /** 当前 Session 的 canonical Message 入口。 */
  messages: SessionMessages;
  /** 当前 Session 的 Mutation 总线。 */
  events: SessionEventHub;
  /** 当前 Session 的用户异步交互运行时。 */
  interactions: SessionInteractionLifecycle;
  /** Shell 高风险操作使用的协议适配器。 */
  shell_approval_gateway: ShellApprovalGateway;
  /** 在 Step 检查点提交 Session 或 Agent 状态 Command。 */
  apply_command: (
    command: Exclude<SessionQueueCommand, { type: "compact" }>,
    turn_id: string,
  ) => Promise<void>;
}
