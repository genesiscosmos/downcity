/**
 * TaskActionExecution：task plugin runtime 的业务执行模块。
 *
 * 关键点（中文）
 * - 这里只放 task 的领域执行逻辑，不放 CLI/API 声明。
 * - task 定义变更后的 scheduler reload 通过回调注入，避免执行层依赖具体 service 实现。
 */

import type { PluginContext } from "@downcity/agent";
import type { PluginExecutionContext } from "@downcity/agent";
import type {
  TaskCronRegisterResult,
  TaskListActionPayload,
  TaskSchedulerReloadResult,
} from "@/task/types/TaskPluginTypes.js";
import type {
  TaskCreateRequest,
  TaskDeleteRequest,
  TaskRunRequest,
  TaskSetStatusRequest,
  TaskUpdateRequest,
} from "@/task/types/TaskCommand.js";
import {
  createTaskDefinition,
  deleteTaskDefinition,
  listTaskDefinitions,
  runTaskDefinition,
  setTaskStatus,
  updateTaskDefinition,
} from "@/task/Action.js";

const TASK_LOG_PREFIX = "[TASK]";

function formatTaskLogMessage(message: string): string {
  return `${TASK_LOG_PREFIX} ${message}`;
}

/**
 * 任务定义变更后的 scheduler 重载端口。
 */
export type TaskSchedulerReloadPort = (params: {
  /**
   * 当前执行上下文。
   */
  context: PluginContext;
  /**
   * 触发本次 reload 的变更动作。
   */
  action: "create" | "update" | "delete" | "status";
  /**
   * 当前操作的任务标题。
   */
  title: string;
}) => Promise<TaskSchedulerReloadResult>;

/**
 * 启动后的 task cron runtime 统计结果。
 */
export type { TaskCronRegisterResult } from "@/task/types/TaskPluginTypes.js";

/**
 * 任务定义变更后重载 scheduler。
 *
 * 关键点（中文）
 * - 解决 create/update 后还沿用旧注册表的时序问题。
 * - 重载失败不阻断主操作，仅记录 warning 供排查。
 */
export async function reloadTaskSchedulerAfterMutation(params: {
  context: PluginContext;
  action: "create" | "update" | "delete" | "status";
  title: string;
  reloadScheduler: (context: PluginContext) => Promise<TaskCronRegisterResult>;
}): Promise<TaskSchedulerReloadResult> {
  try {
    const result = await params.reloadScheduler(params.context);
    params.context.logger.info(
      formatTaskLogMessage("Task scheduler reloaded after mutation"),
      {
        action: params.action,
        title: params.title,
        tasksFound: result.tasksFound,
        jobsScheduled: result.jobsScheduled,
      },
    );
    return {
      reloaded: true,
      tasksFound: result.tasksFound,
      jobsScheduled: result.jobsScheduled,
    };
  } catch (error) {
    const reason = String(error);
    params.context.logger.warn(
      formatTaskLogMessage("Task scheduler reload failed after mutation"),
      {
        action: params.action,
        title: params.title,
        error: reason,
      },
    );
    return {
      reloaded: false,
      error: reason,
    };
  }
}

/**
 * 执行 `task.list` action。
 */
export async function executeTaskListAction(params: {
  context: PluginContext;
  payload: TaskListActionPayload;
}) {
  return {
    success: true,
    data: await listTaskDefinitions({
      project_root: params.context.workspace_path,
      ...(params.payload.status ? { status: params.payload.status } : {}),
    }),
  };
}

/**
 * 执行 `task.create` action。
 */
export async function executeTaskCreateAction(params: {
  context: PluginContext;
  payload: TaskCreateRequest;
  reloadSchedulerAfterMutation: TaskSchedulerReloadPort;
}) {
  const payload = params.payload;
  const result = await createTaskDefinition({
    project_root: params.context.workspace_path,
    request: payload,
  });
  if (!result.success) {
    return {
      success: false,
      error: result.error || "task create failed",
    };
  }
  const scheduler = await params.reloadSchedulerAfterMutation({
    context: params.context,
    action: "create",
    title: String(result.title || payload.title || "").trim() || "unknown",
  });
  return {
    success: true,
    data: {
      ...result,
      scheduler,
    },
  };
}

/**
 * 执行 `task.run` action。
 */
export async function executeTaskRunAction(params: {
  context: PluginContext;
  payload: TaskRunRequest;
  execution_context?: PluginExecutionContext;
}) {
  const result = await runTaskDefinition({
    context: params.context,
    project_root: params.context.workspace_path,
    request: params.payload,
    execution_context: params.execution_context,
  });
  if (!result.success) {
    return {
      success: false,
      error: result.error || "task run failed",
    };
  }
  return {
    success: true,
    data: result,
  };
}

/**
 * 执行 `task.delete` action。
 */
export async function executeTaskDeleteAction(params: {
  context: PluginContext;
  payload: TaskDeleteRequest;
  reloadSchedulerAfterMutation: TaskSchedulerReloadPort;
}) {
  const payload = params.payload;
  const result = await deleteTaskDefinition({
    project_root: params.context.workspace_path,
    request: payload,
  });
  if (!result.success) {
    return {
      success: false,
      error: result.error || "task delete failed",
    };
  }
  const scheduler = await params.reloadSchedulerAfterMutation({
    context: params.context,
    action: "delete",
    title: String(result.title || payload.title || "").trim() || "unknown",
  });
  return {
    success: true,
    data: {
      ...result,
      scheduler,
    },
  };
}

/**
 * 执行 `task.update` action。
 */
export async function executeTaskUpdateAction(params: {
  context: PluginContext;
  payload: TaskUpdateRequest;
  reloadSchedulerAfterMutation: TaskSchedulerReloadPort;
}) {
  const payload = params.payload;
  const result = await updateTaskDefinition({
    project_root: params.context.workspace_path,
    request: payload,
  });
  if (!result.success) {
    return {
      success: false,
      error: result.error || "task update failed",
    };
  }
  const scheduler = await params.reloadSchedulerAfterMutation({
    context: params.context,
    action: "update",
    title: String(result.title || payload.title || "").trim() || "unknown",
  });
  return {
    success: true,
    data: {
      ...result,
      scheduler,
    },
  };
}

/**
 * 执行 `task.status` action。
 */
export async function executeTaskStatusAction(params: {
  context: PluginContext;
  payload: TaskSetStatusRequest;
  reloadSchedulerAfterMutation: TaskSchedulerReloadPort;
}) {
  const payload = params.payload;
  const result = await setTaskStatus({
    project_root: params.context.workspace_path,
    request: payload,
  });
  if (!result.success) {
    return {
      success: false,
      error: result.error || "task status update failed",
    };
  }
  const scheduler = await params.reloadSchedulerAfterMutation({
    context: params.context,
    action: "status",
    title: String(result.title || payload.title || "").trim() || "unknown",
  });
  return {
    success: true,
    data: {
      ...result,
      scheduler,
    },
  };
}
