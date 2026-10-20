/** 基于统一任务事实生成展示状态，宿主不重复实现状态优先级。 */
import type { TaskWorkspaceItem } from "../types/TaskWorkflow.js";

/** 实际运行和待处理结果优先于后台准备状态。 */
export function task_status_label(task: TaskWorkspaceItem): string {
  if (task.running) return "执行中";
  if (task.workflow.work_status === "completed") return "已完成";
  if (task.workflow.work_status === "cancelled") return "已取消";
  if (task.workflow.work_status === "review") return "待验收";
  if (task.state.inbox.some((item) => !item.resolved && item.kind === "failure")) return "执行失败";
  const preparation = task.definition.frontmatter.preparation;
  if (preparation) {
    const labels = { queued: "正在理解", analyzing: "正在理解", delegating: "正在委派", needs_input: "待调整", failed: "理解失败", ready: "" };
    if (labels[preparation.status]) return labels[preparation.status];
    if (preparation.start_error) return "启动失败";
    if (preparation.schedule_error) return "安排尚未生效";
  }
  if (task.definition.frontmatter.status === "enabled" && task.definition.frontmatter.when !== "@manual") return "已安排";
  if (task.definition.frontmatter.kind === "agent") return "待执行";
  return task.workflow.work_status === "in_progress" ? "进行中" : "待开始";
}
