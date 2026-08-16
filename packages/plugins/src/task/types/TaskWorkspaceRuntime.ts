/** TaskPlugin 在单个 Workspace 中持有的运行态类型。 */

import type { TaskCronTriggerEngine } from "@/task/runtime/CronTrigger.js";

/** 单个 Workspace 独立拥有的 Task 调度资源。 */
export interface TaskWorkspaceRuntime {
  /** 当前 Workspace 的 cron 触发引擎。 */
  readonly cron_engine: TaskCronTriggerEngine;

  /** 当前 Workspace 正在执行的任务 ID，用于阻止同一任务并发触发。 */
  readonly running_task_ids: Set<string>;
}
