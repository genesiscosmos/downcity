/**
 * Group Dispatch Session 领域类型。
 *
 * Dispatch Session 只记录群聊调度 Turn，不复制 GroupMessage 正文；消息正文仍由
 * GroupSession 的消息日志作为唯一事实源，调度记录通过消息 ID 建立稳定引用。
 */

import type { Agent } from "@/agent/Agent.js";
import type { GroupMessage } from "@/types/group/Group.js";
import type {
  DispatchDecision,
  DispatchStrategy,
  DispatchTrigger,
} from "@/types/group/DispatchStrategy.js";

/** Dispatch Session 中一次调度 Turn 的持久化状态。 */
export type GroupDispatchTurnStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

/** Dispatch Session 中一次调度 Turn 的完整持久化快照。 */
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

/** Dispatch Session 持久化所需的最小数据能力。 */
export interface GroupDispatchSessionDataStore {
  /** 读取每个 dispatch_id 的最新调度 Turn 快照。 */
  list_turns(): Promise<GroupDispatchTurnRecord[]>;
  /** 以追加日志方式提交一个调度 Turn 的最新完整快照。 */
  append_turn(turn: GroupDispatchTurnRecord): Promise<void>;
}

/** Dispatch Session 成功完成一次调度后的运行结果。 */
export interface GroupDispatchSessionResult {
  /** 当前调度 Turn 的稳定标识。 */
  readonly dispatch_id: string;
  /** 已经校验并持久化的成员投递决定。 */
  readonly decision: DispatchDecision;
}

/** 创建 Group Dispatch Session 的运行依赖。 */
export interface GroupDispatchSessionOptions {
  /** 当前 GroupSession 使用的消息调度策略。 */
  readonly dispatch_strategy: DispatchStrategy;
}

/** 向 Group Dispatch Session 提交一次调度判断的输入快照。 */
export interface GroupDispatchSessionInput {
  /** 本次调度由用户消息还是自动传播触发。 */
  readonly trigger: DispatchTrigger;
  /** 当前调度所围绕的 GroupMessage。 */
  readonly message: GroupMessage;
  /** 当前调度需要一起判断的新增 GroupMessage。 */
  readonly pending_messages: readonly GroupMessage[];
  /** 当前 GroupSession 的完整共享消息快照。 */
  readonly messages: readonly GroupMessage[];
  /** 当前 Group 的成员快照。 */
  readonly members: readonly Agent[];
}
