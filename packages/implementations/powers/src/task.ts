/**
 * `@downcity/powers/task` 独立公开入口。
 *
 * 关键点（中文）：只导出 TaskPower 及其公开构造参数类型。
 */

export { TaskPower } from "./task/TaskPower.js";
export type { TaskPowerOptions } from "./task/types/TaskPowerOptions.js";
export type { TaskServiceContract, TaskWorkInput, TaskMutationResult } from "./task/types/TaskService.js";
export type { TaskWorkspaceSnapshot, TaskWorkspaceItem, TaskWorkspaceSaveInput, TaskInboxItem, TaskWorkflow, TaskOccurrence } from "./task/types/TaskWorkflow.js";
export type { TaskRunDetailView, TaskRunHistoryItemView } from "./task/types/TaskCommand.js";
export type { TaskSchedulerReloadResult } from "./task/types/TaskPowerTypes.js";
