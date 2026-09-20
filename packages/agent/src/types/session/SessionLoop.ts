/**
 * SessionLoop 构造参数与内部 Turn 状态类型。
 *
 * 这些类型描述 Turn 编排所依赖的领域对象，不实现任何调度行为。
 */

import type { ToolCallContext, ToolHookSet } from "@downcity/type";
import type { SessionEventHub } from "@/session/messages/SessionEventHub.js";
import type { SessionMessages } from "@/session/messages/SessionMessages.js";
import type { SessionState } from "@/session/loop/SessionState.js";
import type { AgentSessionTurnResult } from "@/types/sdk/AgentSessionTurn.js";
import type {
  SessionInteractionLifecycle,
  SessionInteractionPort,
} from "@downcity/type";
import type {
  SessionContextAdvanceTrigger,
} from "@/types/session/SessionComposer.js";
import type { StepInput } from "@/session/input/StepInput.js";
import type { SessionExecutorPort } from "@/session/runner/SessionExecutor.js";
import type { SessionQueue } from "@/session/loop/SessionQueue.js";
import type { Logger } from "@/utils/logger/Logger.js";
import type { SessionTurnContext } from "@/types/turn/SessionTurnContext.js";
import type { SessionOrigin } from "@downcity/type";

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
  /** 当前 Turn 是否已经接收并持久化首条 Prompt。 */
  prompt_started: boolean;
}

/** SessionLoop 构造参数。 */
export interface SessionLoopOptions {
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Session 的完整来源元数据。 */
  session_origin: SessionOrigin;
  /** 当前 Session 所属 Workspace 的绝对根目录。 */
  workspace_path: string;
  /**
   * 已装配的执行器。
   *
   * 关键点（中文）：省略时本 Loop 自行创建默认 `SessionExecutor`；传入后只调用该实现。
   */
  executor?: SessionExecutorPort;
  /**
   * 每步的模型输入装配者。
   *
   * 关键点（中文）：省略时表示调用方注入了自带输入的 `executor`，本 Loop 不再装配输入。
   */
  step_input?: StepInput;
  /** Turn 结束后按需推进 Composer 派生上下文。 */
  maintain_context: () => Promise<void>;
  /** 请求推进派生上下文；Provider 上下文超限时由执行器调用。 */
  advance_context: (
    trigger: SessionContextAdvanceTrigger,
  ) => Promise<boolean>;
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
  /** 读取当前生效的扩展处理器集合。 */
  get_hooks: () => ToolHookSet;
  /** 构造当前 Turn 的调用环境快照。 */
  create_call_context: (input: {
    /** 当前 Turn 稳定标识。 */
    readonly turn_id: string;
    /** 当前 Turn 的取消信号。 */
    readonly abort_signal: AbortSignal;
  }) => ToolCallContext;
}
