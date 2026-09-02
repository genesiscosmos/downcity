/**
 * GroupSession 内部调度协议。
 *
 * 调度不是独立 Session，只是 GroupSession 根据共享消息和成员画像计算下一步阶段计划的
 * 内部运行过程。本模块描述该过程的输入、结果与持久化记录。
 */

import type { GroupMessage } from "@/types/group/Group.js";
import type {
  DispatchGroupProfile,
  DispatchMemberProfile,
  DispatchDecision,
  DispatchStrategy,
  DispatchTrigger,
} from "@/types/group/DispatchStrategy.js";

/** GroupSession 中一次调度 Turn 的持久化状态。 */
export type GroupDispatchTurnStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

/** GroupSession 中一次调度 Turn 的完整持久化快照。 */
export interface GroupDispatchTurnRecord {
  /** 当前调度 Turn 的稳定标识。 */
  readonly dispatch_id: string;
  /** 本次调度由用户消息还是自动传播触发。 */
  readonly trigger: DispatchTrigger;
  /** 当前调度所围绕的 GroupMessage 标识。 */
  readonly message_id: string;
  /** 当前调度需要一起判断的新增 GroupMessage 标识。 */
  readonly pending_message_ids: readonly string[];
  /** 当前调度 Turn 的生命周期状态。 */
  readonly status: GroupDispatchTurnStatus;
  /** 调度成功后已经校验并持久化的成员投递决定。 */
  readonly decision?: DispatchDecision;
  /** 调度失败或停止时用于诊断的稳定错误文本。 */
  readonly error?: string;
  /** 当前调度 Turn 首次入队的 Unix 毫秒时间戳。 */
  readonly created_at: number;
  /** 当前状态最近一次提交的 Unix 毫秒时间戳。 */
  readonly updated_at: number;
}

/** GroupSession 完成一次调度后的内部运行结果。 */
export interface GroupDispatchResult {
  /** 当前调度 Turn 的稳定标识。 */
  readonly dispatch_id: string;
  /** 已经校验并持久化的成员投递决定。 */
  readonly decision: DispatchDecision;
}

/** 创建 Group 调度运行器的内部依赖。 */
export interface GroupDispatchRuntimeOptions {
  /** 当前 GroupSession 使用的消息调度策略。 */
  readonly dispatch_strategy: DispatchStrategy;
}

/** GroupSession 提交给调度策略的一次不可变输入快照。 */
export interface GroupDispatchInput {
  /** 当前 Group 的只读语义画像。 */
  readonly group: DispatchGroupProfile;
  /** 本次调度由用户消息还是自动传播触发。 */
  readonly trigger: DispatchTrigger;
  /** 当前调度所围绕的 GroupMessage。 */
  readonly current_message: GroupMessage;
  /** 当前调度需要一起判断的新增 GroupMessage。 */
  readonly pending_messages: readonly GroupMessage[];
  /** 本批新增消息之前的最近 Group 对话。 */
  readonly history: readonly GroupMessage[];
  /** 当前 Group 成员的只读语义画像。 */
  readonly members: readonly DispatchMemberProfile[];
}
