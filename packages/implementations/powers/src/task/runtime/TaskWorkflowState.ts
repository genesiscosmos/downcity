/**
 * 发生项与收件箱状态的登记、结算与收口。
 *
 * 状态嵌在 `task.toml` 的 `[workflow]`、`[[occurrences]]`、`[[inbox]]` 里，通过同一个
 * `TaskDefinitionRepository` 事务原子提交，避免定义、收件箱与周期历史出现多个事实源。
 * 执行令牌保护迟到结果，Run 文件继续独立保存。
 */

import type { ShipTaskDefinitionV1 } from "../types/Task.js";
import type { TaskDefinitionRepository } from "./TaskDefinitionRepository.js";
import {
  normalize_task_state,
  task_is_recurring,
  task_occurrence_key,
} from "./TaskWorkflowModel.js";
import { readTask, writeTask } from "./Store.js";

/** 在已持有定义事务的情况下保存定义，防止跨文件部分提交。 */
export async function save_task_workflow(
  definitions: TaskDefinitionRepository,
  task: ShipTaskDefinitionV1,
): Promise<void> {
  await writeTask({
    storage: definitions.storage,
    taskId: task.taskId,
    overwrite: true,
    task,
  });
}

/** 登记一次计划发生；调用者持有定义事务。重复计划返回 false。 */
export function register_task_occurrence(
  task: ShipTaskDefinitionV1,
  at: Date,
  execution_id?: string,
): boolean {
  const state = normalize_task_state(task.workflow);
  const occurrence_id = task_occurrence_key(task, at);
  if (state.occurrences.some((item) => item.occurrence_id === occurrence_id))
    return false;
  state.occurrences.push({
    occurrence_id,
    planned_at: at.toISOString(),
    status: execution_id ? "in_progress" : "pending",
    ...(execution_id ? { execution_id } : {}),
  });
  if (!execution_id)
    state.inbox.push({
      item_id: `reminder:${occurrence_id}`,
      kind: "reminder",
      message: "到了计划时间，请处理这件事",
      created_at: at.toISOString(),
      resolved: false,
      occurrence_id,
    });
  task.workflow = state;
  return true;
}

/** 将某次执行结果同步到工作状态，忽略不再属于当前工作的迟到结果。 */
export async function settle_task_execution(params: {
  /** 唯一的定义事务所有者。 */
  definitions: TaskDefinitionRepository;
  /** 启动时的任务快照，决定本次是否需要验收。 */
  task: ShipTaskDefinitionV1;
  /** 本次实际执行的令牌。 */
  execution_id: string;
  /** 是否通过执行和结果校验。 */
  success: boolean;
  /** 可选产物目录时间戳，异常发生在写入前时为空。 */
  timestamp?: string;
  /** 失败原因；成功时为空。 */
  error?: string;
}): Promise<void> {
  await params.definitions.mutate(async () => {
    const current = await readTask({
      storage: params.definitions.storage,
      taskId: params.task.taskId,
    });
    const state = normalize_task_state(current.workflow);
    if (state.active_execution_id !== params.execution_id) return;
    const recurring = task_is_recurring(params.task);
    const review =
      params.success &&
      (!recurring || normalize_task_state(params.task.workflow).require_acceptance);
    const occurrence = state.occurrences.find(
      (item) => item.execution_id === params.execution_id,
    );
    if (occurrence) {
      occurrence.status = params.success
        ? review
          ? "review"
          : "completed"
        : "pending";
      if (params.timestamp) occurrence.run_timestamp = params.timestamp;
      if (params.success && !review)
        occurrence.completed_at = new Date().toISOString();
    }
    if (!recurring)
      state.progress = params.success ? "review" : "in_progress";
    delete state.active_execution_id;
    if (!params.success || review)
      state.inbox.push({
        item_id: `${params.success ? "review" : "failure"}:${params.execution_id}`,
        kind: params.success ? "review" : "failure",
        message: params.success
          ? "结果已提交，请验收"
          : params.error || "执行失败，请查看结果并决定下一步",
        created_at: new Date().toISOString(),
        resolved: false,
        ...(occurrence ? { occurrence_id: occurrence.occurrence_id } : {}),
        ...(params.timestamp ? { run_timestamp: params.timestamp } : {}),
      });
    current.workflow = state;
    await save_task_workflow(params.definitions, current);
  });
}
