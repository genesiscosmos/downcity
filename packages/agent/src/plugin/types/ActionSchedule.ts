/**
 * ActionSchedule：plugin action 延迟执行能力的共享类型。
 *
 * 关键点（中文）
 * - 这里描述的是“某个 plugin action 在未来某个时间执行”的通用记录。
 * - 它不是独立 Plugin，也不表达业务语义，只服务于 Plugin Action 调度。
 * - 外部请求字段仍可叫 `schedule`，但内部类型统一归入 ActionSchedule 模块。
 */

import type { JsonValue } from "@/types/common/Json.js";

/**
 * ActionSchedule 任务状态。
 */
export type ActionScheduleJobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

/**
 * ActionSchedule 任务完整记录。
 */
export interface ActionScheduleJobRecord {
  /**
   * ActionSchedule 任务唯一 ID。
   */
  id: string;
  /** 执行该任务的 Agent 稳定标识。 */
  agent_id: string;
  /** 任务所属 Workspace 的稳定标识。 */
  workspace_id?: string;
  /**
   * 目标 plugin 名称。
   */
  plugin_name: string;
  /**
   * 目标 action 名称。
   */
  action_name: string;
  /**
   * 原始 action payload。
   */
  payload: JsonValue;
  /**
   * 计划执行时间（毫秒时间戳）。
   */
  run_at_ms: number;
  /**
   * 当前任务状态。
   */
  status: ActionScheduleJobStatus;
  /**
   * 最近一次错误文本。
   */
  error?: string;
  /**
   * 创建时间（毫秒时间戳）。
   */
  created_at: number;
  /**
   * 最近更新时间（毫秒时间戳）。
   */
  updated_at: number;
}

/**
 * 创建 ActionSchedule 任务所需输入。
 */
export interface CreateActionScheduleJobInput {
  /** 任务执行时解析 PluginContext 所需的 Workspace 稳定标识；省略时使用当前活动 Workspace。 */
  workspace_id: string;
  /**
   * 目标 plugin 名称。
   */
  plugin_name: string;
  /**
   * 目标 action 名称。
   */
  action_name: string;
  /**
   * 目标 action payload。
   */
  payload: JsonValue;
  /**
   * 计划执行时间（毫秒时间戳）。
   */
  run_at_ms: number;
}

/**
 * 统一 plugin action 延迟执行输入。
 */
export interface PluginActionScheduleInput {
  /**
   * 计划执行时间（毫秒时间戳）。
   */
  run_at_ms: number;
}
