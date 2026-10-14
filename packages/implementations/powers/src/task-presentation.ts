/**
 * 浏览器可用的任务展示入口。
 *
 * 仅导出纯展示函数与类型，避免 renderer 加载 TaskPower 的 Node.js 调度依赖。
 */
export { task_status_label } from "./task/runtime/TaskPresentation.js";
export type { TaskWorkspaceItem } from "./task/types/TaskWorkflow.js";
