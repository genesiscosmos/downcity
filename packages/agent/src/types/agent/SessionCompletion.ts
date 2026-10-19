/**
 * Agent 持久化完成通知协议。
 * 每个 Turn 只有一个稳定完成事件；回调至少投递一次，处理器按 completion_id 幂等消费。
 */
import type { EffectHook, FileSystem, SessionOrigin, SessionTurnCommittedHookValue, ToolCallContext } from "@downcity/type";

/** 完成事件的可恢复投递记录，不保存函数、环境变量或运行时句柄。 */
export interface SessionCompletionRecord {
  /** 该 Turn 已持久化的完成事件与结果。 */
  event: SessionTurnCommittedHookValue;
  /** 会话来源分区，用于重启后恢复正确的 Session。 */
  origin: SessionOrigin;
  /** 事件发生时的项目标识；回调恢复时使用该执行上下文。 */
  workspace_id?: string;
  /** 成功表示所有当时注册的处理器已接受；失败仍可重试。 */
  state: "pending" | "delivered";
  /** 已失败的投递次数，用于指数退避。 */
  attempt_count: number;
  /** 下一次允许尝试投递的绝对时间戳，单位毫秒。 */
  retry_at: number;
  /** 最近一次投递失败的说明。 */
  error?: string;
}

/** Agent 完成投递运行时的窄依赖。 */
export interface SessionCompletionOptions {
  /** Agent 自有文件端口；完成日志不进入项目文件。 */
  files: FileSystem;
  /** 读取最新注册的完成处理器；恢复不会执行旧的函数快照。 */
  get_handlers: () => readonly EffectHook[];
  /** 根据持久化身份恢复回调上下文；不能再次发起模型输入。 */
  restore_context: (record: SessionCompletionRecord) => Promise<ToolCallContext>;
  /** 报告持久化或重试异常，不能吞掉后台错误。 */
  report_error: (error: unknown) => void;
}
