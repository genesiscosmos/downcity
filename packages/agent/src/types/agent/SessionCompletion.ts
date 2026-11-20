/**
 * Agent 持久化完成通知协议。
 * 每个 Turn 只有一个稳定完成事件；回调至少投递一次，处理器按 completion_id 幂等消费。
 */
import type { EffectHook, FileSystem, SessionDescriptor, SessionTurnCommittedHookValue, ToolCallContext } from "@downcity/type";

/** 完成事件的可恢复投递记录，不保存函数、环境变量或运行时句柄。 */
export interface SessionCompletionRecord extends SessionDescriptor {
  /** 该 Turn 已持久化的完成事件与结果。 */
  event: SessionTurnCommittedHookValue;
  /** 同一 Turn 最近一次 Retry 调用的当前结果；原投递 event 永不改变。 */
  current?: SessionTurnCommittedHookValue;

  /** 事件发生时的项目标识；回调恢复时使用该执行上下文。 */
  workspace_id?: string;
  /** 成功表示所有当时注册的处理器已接受；失败仍可重试。 */
  state: "prepared" | "pending" | "delivered";
  /** 事件提交时绑定的接收方及独立确认；缺席的处理器不会被默认为成功。 */
  deliveries: Record<string, {
    /** 当前接收方是否已经确认接受。 */
    delivered: boolean;
    /** 当前接收方已失败次数。 */
    attempt_count: number;
    /** 当前接收方下一次允许重试的时间戳。 */
    retry_at: number;
    /** 最近失败说明。 */
    error?: string;
  }>;
}

/** Session 在终态提交前借用的写前日志端口；写入异常必须向调用方传播。 */
export interface SessionCompletionPort {
  /** 提交请求前确认回调已注册，避免执行完成后才发现没有接收方。 */
  validate_callback(name: string): void;
  /** 模型执行结束、canonical 消息关闭前保存结果与接收方快照。 */
  prepare(event: SessionTurnCommittedHookValue, context: ToolCallContext): Promise<void>;
  /** 仅更新 Turn 当前结果，不注册或唤醒已结算调用的接收方。 */
  update_result(event: SessionTurnCommittedHookValue, context: ToolCallContext): Promise<void>;
  /** 原调用的不可变结果，用于 request_id 幂等结果。 */
  read_initial(session_id: string, turn_id: string): Promise<SessionTurnCommittedHookValue | undefined>;
  /** 读取当前 Turn 权威结果，Retry 可将其更新为成功。 */
  read(session_id: string, turn_id: string): Promise<SessionTurnCommittedHookValue | undefined>;
}

/** Agent 完成投递运行时的窄依赖。 */
export interface SessionCompletionOptions {
  /** Agent 自有文件端口；完成日志不进入项目文件。 */
  files: FileSystem;
  /** 读取最新注册的完成处理器；恢复不会执行旧的函数快照。 */
  get_handlers: () => readonly EffectHook[];
  /** 根据持久化身份恢复回调上下文；不能再次发起模型输入。 */
  restore_context: (record: SessionCompletionRecord) => Promise<ToolCallContext>;
  /** 每次回调最大执行时间，超时保留待投递状态；默认 30 秒。 */
  timeout_ms?: number;
  /** 报告持久化或重试异常，不能吞掉后台错误。 */
  report_error: (error: unknown) => void;
}
