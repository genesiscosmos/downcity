/**
 * Task power runtime 类型定义。
 *
 * 关键点（中文）
 * - 这里集中声明 task power runtime 在类化拆分后共享的 action payload 与调度结果类型。
 * - 跨模块复用的 task power runtime 类型统一收敛在 `powers/task/types/`。
 */

import type { PowerJsonObject, PowerStorage } from "@downcity/city/power";
import type { ShipTaskStatus, TaskDeliverySession } from "@/task/types/Task.js";
import type { TaskDefinitionRepository } from "@/task/runtime/TaskDefinitionRepository.js";

/**
 * `task.list` action 的输入载荷。
 */
export type TaskListActionPayload = {
  /**
   * 按任务状态过滤；省略时返回全部状态。
   */
  status?: ShipTaskStatus;
};

/**
 * task cron runtime 启动或重载后的统计结果。
 */
export type TaskCronRegisterResult = {
  /**
   * 本次扫描到的任务定义数量。
   */
  tasks_found: number;
  /**
   * 本次成功注册到 cron engine 的作业数量。
   */
  jobs_scheduled: number;
  /**
   * 本次扫描到但无法读取或解析的任务定义数量。
   */
  tasks_invalid: number;
};

/**
 * 任务定义变更后 scheduler 重载结果。
 */
export type TaskSchedulerReloadResult = {
  /**
   * scheduler 是否成功完成重载。
   */
  reloaded: boolean;
  /**
   * 成功重载时扫描到的任务数量。
   */
  tasks_found?: number;
  /**
   * 成功重载时注册成功的 cron 作业数量。
   */
  jobs_scheduled?: number;
  /**
   * 成功完成扫描但定义无效的任务数量。
   */
  tasks_invalid?: number;
  /**
   * 重载失败时的错误文本。
   */
  error?: string;
};

/** Task Store 向调用面提供的完整列表项。 */
export interface TaskListItem {
  /** Task 的稳定目录 ID。 */
  readonly taskId: string;
  /** Task 的用户可见唯一标题。 */
  readonly title: string;
  /** Task 的用途说明。 */
  readonly description: string;
  /** Task 的完整执行正文。 */
  readonly body?: string;
  /** Task 的触发定义。 */
  readonly when: string;
  /** Task 当前启停状态。 */
  readonly status: string;
  /** Task 唯一绑定的执行 Agent。 */
  readonly agent_id: string;
  /** Task 唯一绑定的执行 Workspace。 */
  readonly workspace_id: string;
  /** Task 完成结果的固定 Session 交付目标。 */
  readonly delivery_session?: TaskDeliverySession;
  /** Task 使用 Agent 还是脚本执行。 */
  readonly kind?: "agent" | "script";
  /** Agent Task 是否启用多轮复核。 */
  readonly review?: boolean;
  /** task.md 相对 PowerStorage 根目录的路径。 */
  readonly taskMdPath: string;
  /** 最近一次 run 使用的时间戳目录名。 */
  readonly lastRunTimestamp?: string;
}

/** Task Store 中一条无法读取或解析的 canonical 定义。 */
export interface TaskDefinitionIssue extends PowerJsonObject {
  /** Task 聚合目录使用的稳定 ID。 */
  readonly task_id: string;
  /** task.md 相对 PowerStorage 根目录的路径。 */
  readonly task_md_path: string;
  /** 定义无法使用的明确原因。 */
  readonly error: string;
}

/** Task Store 一次完整扫描的有效定义与损坏定义结果。 */
export interface TaskStoreInspection {
  /** 可以安全读取和执行的 Task 定义。 */
  readonly tasks: TaskListItem[];
  /** 必须向宿主暴露、但不能进入执行路径的损坏定义。 */
  readonly issues: TaskDefinitionIssue[];
}

/** Task scheduler 调用 Agent action 后需要读取的最小结果。 */
export interface ScheduledTaskActionResult {
  /** Action 是否成功完成协议调用。 */
  readonly success?: boolean;
  /** Action 失败时的稳定错误文本。 */
  readonly error?: string;
  /** Action 成功时携带的 Task run 结果。 */
  readonly data?: {
    /** Task run 是否真正被执行协调器受理。 */
    readonly accepted?: boolean;
  };
}

/** 宿主管理 action 使用的 TaskPower 实例能力。 */
export interface TaskPowerHostRuntime {
  /** TaskPower 生命周期级统一存储。 */
  readonly storage: PowerStorage;
  /** TaskPower 唯一的定义事务入口。 */
  readonly definitions: TaskDefinitionRepository;
  /** 在 Task 定义提交后更新其 scheduler 注册。 */
  readonly reconcile: (task_id: string) => Promise<TaskSchedulerReloadResult>;
}
