/**
 * SessionLoop 构造参数与内部 Turn 状态类型。
 *
 * 这些类型描述 Turn 编排所依赖的领域对象，不实现任何调度行为。
 */

import type { ShellApprovalGateway } from "@downcity/workspace";
import type { SessionEventHub } from "@/session/runtime/SessionEventHub.js";
import type { SessionMessages } from "@/session/SessionMessages.js";
import type { SessionState } from "@/session/SessionState.js";
import type { AgentSessionTurnResult } from "@/types/sdk/AgentSessionTurn.js";
import type {
  SessionInteractionLifecycle,
  SessionInteractionPort,
} from "@/types/session/SessionInteraction.js";
import type {
  SessionCompactHistory,
  SessionExecutor,
} from "@/types/session/SessionExecution.js";
import type { SessionQueue } from "@/session/SessionQueue.js";
import type { Logger } from "@/utils/logger/Logger.js";
import type { SessionTurnContext } from "@/types/executor/SessionTurnContext.js";

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
  /** 当前 Turn 进入执行阶段后拥有的唯一上下文。 */
  turn_context: SessionTurnContext | null;
  /** 下一 Step 是否需要重新读取 canonical history。 */
  history_reload_requested: boolean;
  /** 当前 Turn 是否已经接收并持久化首条 Prompt。 */
  prompt_started: boolean;
}

/** SessionLoop 构造参数。 */
export interface SessionLoopOptions {
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Session 所属 Workspace 的绝对根目录。 */
  workspace_path: string;
  /** 当前 Session 的模型执行器。 */
  executor: SessionExecutor;
  /** 由 Session 领域提供的 canonical 历史压缩入口。 */
  compact_history: SessionCompactHistory;
  /** 当前 Session 的配置与 Metadata 状态。 */
  state: SessionState;
  /** 当前 Session 的 canonical Message 入口。 */
  messages: SessionMessages;
  /** 当前 Session 的 Mutation 总线。 */
  events: SessionEventHub;
  /** 当前 Session 的统一日志器。 */
  logger: Logger;
  /** 当前 Session 拥有的有序 Command 队列。 */
  queue: SessionQueue;
  /** 当前 Session 的用户异步交互运行时。 */
  interactions: SessionInteractionLifecycle & SessionInteractionPort;
  /** Shell 高风险操作使用的协议适配器。 */
  shell_approval_gateway: ShellApprovalGateway;
}
