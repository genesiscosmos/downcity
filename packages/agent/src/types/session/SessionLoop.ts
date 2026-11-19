/**
 * SessionLoop 构造参数与内部 Turn 状态类型。
 *
 * 这些类型描述 Turn 编排所依赖的领域对象，不实现任何调度行为。
 */

import type { SessionChildWork } from "./SessionChildWork.js";
import type { SessionCompletionPort } from "@/types/agent/SessionCompletion.js";
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
  /** 拒绝尚未被 Session 接受的输入；Turn 完成结果仍通过 resolve 返回。 */
  reject: (reason: unknown) => void;
}

/** 幂等 Prompt 在 canonical history 中使用的稳定身份。 */
export interface PromptRequestIdentity {
  /** 真人输入的稳定 User Message 标识。 */
  message_id: string;
  /** 运行时输入的稳定 input 标识，不依赖承载 Agent Message 的身份。 */
  input_id: string;
  /** 首条输入对应的稳定 Turn 标识，合并输入时以实际 Turn 为准。 */
  turn_id: string;
}

/** 当前活跃 Turn 的内存状态。 */
export interface ActiveSessionTurnState {
  /** 当前 Turn 的稳定标识。 */
  turn_id: string;
  /** Retry 消息的接收水位；同 Turn 的旧 Stop 不能控制恢复后的新调用。 */
  resumed_message?: import("@downcity/type").SessionMessageCheckpoint;
  /** 本次调用是否为原 Step Retry；完成投递只属于已结算的原调用。 */
  is_retry?: boolean;
  /** 本次方法调用已经写前确认的完成快照。 */
  prepared_completion?: import("@downcity/type").SessionTurnCommittedHookValue;
  /** Loop 在运行租约释放后才兑现 finished；离线恢复收口可以直接兑现。 */
  settle_after_release?: boolean;
  /** 当前 Turn 的最终结果快照。 */
  result: AgentSessionTurnResult | null;
  /** 当前 Turn 完成状态的延迟控制器。 */
  deferred_finished: SessionDeferred<AgentSessionTurnResult>;
  /** 当前 Turn 进入执行阶段后拥有的唯一上下文。 */
  turn_context: SessionTurnContext | null;
  /** 新 Retry 执行的首步描述；消费后立即释放。 */
  replay?: import("./SessionModelInput.js").SessionModelReplay;
  /** 当前 Turn 是否已经接收并持久化首条 Prompt。 */
  prompt_started: boolean;
}

/** 原请求的幂等结果查询；当前 Retry 调用不得覆盖原接收句柄。 */
export interface SessionPromptLookupOptions {
  /** 被查询的原业务输入身份。 */ identity: PromptRequestIdentity;
  /** canonical 输入事实的唯一来源。 */ messages: SessionMessages;
  /** 当前活动方法调用，仅原调用可以复用其未完成句柄。 */ active_turn: ActiveSessionTurnState | null;
  /** 原结果与 Turn 当前结果共用的完成记录端口。 */ completions?: SessionCompletionPort;
  /** 当前 Session 稳定标识。 */ session_id: string;
}

/** SessionLoop 构造参数。 */
export interface SessionLoopOptions {
  /** Turn 实际执行（包括恢复）的宿主租约，覆盖完整收尾。 */
  acquire_execution?: () => () => void;
  /** Turn 终态前的可靠写前日志；省略时只提供普通 Session Hook。 */
  completions?: SessionCompletionPort;
  /** Agent 提供的子工作等待与取消能力，不由 Loop 管理委派存储。 */
  child_work?: SessionChildWork;
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Session 的完整来源元数据。 */
  session_origin: SessionOrigin;
  /**
   * 当前 Session 的目录解析器。
   *
   * 关键点（中文）：目录是可变的会话状态，因此按需读取而不是构造时固定。
   */
  get_workspace_path: () => string;
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
    signal?: AbortSignal,
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
