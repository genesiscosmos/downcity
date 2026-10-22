/** 基于统一任务事实生成展示状态，宿主不重复实现状态优先级。 */
import type { TaskWorkspaceItem } from "../types/TaskWorkflow.js";

/** 实际运行和待处理结果优先于后台准备状态。 */
export function task_status_label(task: TaskWorkspaceItem): string {
  const definition = task.definition;
  if (task.running) return "执行中";
  if (definition.workflow.progress === "completed") return "已完成";
  if (definition.workflow.progress === "cancelled") return "已取消";
  if (definition.workflow.progress === "review") return "待验收";
  if (definition.workflow.inbox.some((item) => !item.resolved && item.kind === "failure")) return "执行失败";
  const preparation = definition.preparing;
  if (preparation) {
    const labels = { queued: "正在理解", analyzing: "正在理解", delegating: "正在委派", needs_input: "待调整", failed: "理解失败", ready: "" };
    if (labels[preparation.status]) return labels[preparation.status];
    if (preparation.start_error) return "启动失败";
    if (preparation.schedule_error) return "安排尚未生效";
  }
  if (definition.schedule === "enabled" && definition.when !== "@manual") return "已安排";
  if (definition.kind === "agent") return "待执行";
  return definition.workflow.progress === "in_progress" ? "进行中" : "待开始";
}
