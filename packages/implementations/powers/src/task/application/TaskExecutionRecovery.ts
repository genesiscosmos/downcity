/** City 启动时恢复中断执行：保留历史、暂停安排，由用户明确决定重试。 */
import type { TaskDefinitionRepository } from "../runtime/TaskDefinitionRepository.js";
import { inspect_task_definitions, readTask, writeTask } from "../runtime/Store.js";
import { normalize_task_workflow, task_is_recurring } from "../runtime/TaskWorkflowModel.js";
import { list_task_runs, read_completed_task_run } from "../runtime/TaskRunStore.js";
import { normalize_task_workflow_state } from "../runtime/TaskWorkflowStateSchema.js";

/** 只在执行协调器尚未受理新工作时调用，不自动重放外部副作用。 */
export async function recover_task_executions(definitions: TaskDefinitionRepository): Promise<void> {
  const inspection = await inspect_task_definitions(definitions.storage);
  for (const entry of inspection.tasks) {
    await definitions.mutate(async (storage) => {
      const task = await readTask({ storage, taskId: entry.taskId });
      const workflow = normalize_task_workflow(task.frontmatter.workflow);
      const execution_id = workflow.active_execution_id;
      if (!execution_id || definitions.is_running(entry.taskId)) return;
      // 用户确认的终态优先于残留执行记录，恢复不得重新打开工作。
      if (["completed", "cancelled"].includes(workflow.work_status)) {
        delete workflow.active_execution_id;
        task.frontmatter.status = "paused";
        task.frontmatter.workflow = workflow;
        await writeTask({ storage, taskId: entry.taskId, frontmatter: task.frontmatter, body: task.body, overwrite: true });
        return;
      }
      const state = normalize_task_workflow_state(task.frontmatter.workflow_state);
      const occurrence = state.occurrences.find((item) => item.execution_id === execution_id);
      const runs = await list_task_runs({ storage, task_id: entry.taskId });
      const summary = runs.find((item) => item.execution_id === execution_id);
      // 完成元数据须有效且属于当前执行；进度终态不能代替提交结果。
      const completed = summary ? await read_completed_task_run({ storage, task_id: entry.taskId, timestamp: summary.timestamp }) : undefined;
      const run = completed?.execution_id === execution_id ? completed : undefined;
      if (run && run.ended_at !== undefined) {
        const recurring = task_is_recurring(task);
        const success = run.status === "success"
          && run.execution_status === "success"
          && (run.result_status === "valid" || run.result_status === "not_checked");
        const review = success && (!recurring || workflow.require_acceptance);
        if (occurrence) {
          occurrence.status = success ? (review ? "review" : "completed") : "pending";
          occurrence.run_timestamp = run.timestamp;
          if (success && !review) occurrence.completed_at = new Date(run.ended_at!).toISOString();
        }
        if (!recurring) workflow.work_status = review ? "review" : "in_progress";
        if (!success || review) {
          const item_id = `${review ? "review" : "failure"}:${execution_id}`;
          if (!state.inbox.some((item) => item.item_id === item_id)) state.inbox.push({
            item_id, kind: review ? "review" : "failure",
            message: review ? "结果已提交，请验收" : run.error || "上次执行未通过，请查看结果后决定是否重试",
            created_at: new Date(run.ended_at!).toISOString(), resolved: false,
            run_timestamp: run.timestamp,
            ...(occurrence ? { occurrence_id: occurrence.occurrence_id } : {}),
          });
        }
        delete workflow.active_execution_id;
        // 周期工作保留其后续安排；一次性工作已受理后不再重新启动。
        if (!recurring) task.frontmatter.status = "paused";
        task.frontmatter.workflow = workflow;
        task.frontmatter.workflow_state = state;
        await writeTask({ storage, taskId: entry.taskId, frontmatter: task.frontmatter, body: task.body, overwrite: true });
        return;
      }
      if (occurrence && occurrence.status === "in_progress") occurrence.status = "pending";
      if (occurrence && summary) occurrence.run_timestamp = summary.timestamp;
      const item_id = `interrupted:${execution_id}`;
      if (!state.inbox.some((item) => item.item_id === item_id)) state.inbox.push({
        item_id, kind: "failure", message: "上次执行已中断，自动安排已暂停，请查看历史后决定是否重试",
        created_at: new Date().toISOString(), resolved: false,
        ...(occurrence ? { occurrence_id: occurrence.occurrence_id } : {}),
        ...(occurrence?.run_timestamp ? { run_timestamp: occurrence.run_timestamp } : {}),
      });
      delete workflow.active_execution_id;
      task.frontmatter.status = "paused";
      task.frontmatter.workflow = workflow;
      task.frontmatter.workflow_state = state;
      await writeTask({ storage, taskId: entry.taskId, frontmatter: task.frontmatter, body: task.body, overwrite: true });
    });
  }
}
