/**
 * TaskActionExecution：task power runtime 的业务执行模块。
 *
 * 关键点（中文）
 * - 这里只放 task 的领域执行逻辑，不放 CLI/API 声明。
 * - task 定义变更后的 scheduler reload 通过回调注入，避免执行层依赖具体 service 实现。
 */

import type { PowerContext } from "@downcity/city/power";
import type { PowerCallScope } from "@downcity/city/power";
import type { PowerExecutionContext } from "@downcity/city/power";
import type { PowerNotificationPublisher } from "@downcity/city/power";
import type { PowerJsonValue } from "@downcity/city/power";
import type { PowerStorage } from "@downcity/city/power";
import type {
  TaskCronRegisterResult,
  TaskListActionPayload,
  TaskSchedulerReloadResult,
} from "@/task/types/TaskPowerTypes.js";
import type {
  TaskCreateRequest,
  TaskDeleteRequest,
  TaskRunDetailRequest,
  TaskRunHistoryRequest,
  TaskRunRequest,
  TaskSetStatusRequest,
  TaskUpdateRequest,
} from "@/task/types/TaskCommand.js";
import {
  createTaskDefinition,
  deleteTaskDefinition,
  listTaskDefinitions,
  list_task_run_history,
  read_task_run,
  runTaskDefinition,
  setTaskStatus,
  updateTaskDefinition,
} from "@/task/Action.js";
import { deriveTaskIdFromTitle } from "@/task/runtime/Paths.js";
import { readTask, resolveTaskIdByTitle } from "@/task/runtime/Store.js";
import type { TaskExecutionCoordinator } from "@/task/runtime/TaskExecutionCoordinator.js";
import type { TaskDefinitionRepository } from "@/task/runtime/TaskDefinitionRepository.js";
import type { TaskCompletionDeliveryPort } from "@/task/types/TaskRunner.js";

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
  context: PowerContext;
  /**
   * 触发本次 reload 的变更动作。
   */
  action: "create" | "update" | "delete" | "status";
  /**
   * 当前操作的任务标题。
   */
  title: string;
  /** mutation 已提交的稳定 Task ID。 */
  task_id: string;
}) => Promise<TaskSchedulerReloadResult>;

/**
 * 启动后的 task cron runtime 统计结果。
 */
export type { TaskCronRegisterResult } from "@/task/types/TaskPowerTypes.js";

/**
 * 任务定义变更后重载 scheduler。
 *
 * 关键点（中文）
 * - 解决 create/update 后还沿用旧注册表的时序问题。
 * - 重载失败不阻断主操作，仅记录 warning 供排查。
 */
export async function reloadTaskSchedulerAfterMutation(params: {
  context: PowerContext;
  action: "create" | "update" | "delete" | "status";
  title: string;
  task_id: string;
  reloadScheduler: (task_id: string) => Promise<TaskCronRegisterResult>;
}): Promise<TaskSchedulerReloadResult> {
  try {
    const result = await params.reloadScheduler(params.task_id);
    params.context.logger.info(
      formatTaskLogMessage("Task scheduler reloaded after mutation"),
      {
        action: params.action,
        title: params.title,
        tasks_found: result.tasks_found,
        jobs_scheduled: result.jobs_scheduled,
        tasks_invalid: result.tasks_invalid,
      },
    );
    return {
      reloaded: true,
      tasks_found: result.tasks_found,
      jobs_scheduled: result.jobs_scheduled,
      tasks_invalid: result.tasks_invalid,
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
  context: PowerContext;
  storage: PowerStorage;
  payload: TaskListActionPayload;
}) {
  return {
    success: true,
    data: await listTaskDefinitions({
      storage: params.storage,
      agent_id: params.context.agent.id,
      ...(params.payload.status ? { status: params.payload.status } : {}),
    }),
  };
}

/** 执行 `task.history` action。 */
export async function execute_task_history_action(params: {
  /** 当前 Power 执行上下文。 */
  readonly context: PowerContext;
  /** TaskPower 生命周期级统一存储。 */
  readonly storage: PowerStorage;
  /** 执行记录查询输入。 */
  readonly payload: TaskRunHistoryRequest;
}) {
  const result = await list_task_run_history({
    storage: params.storage,
    request: params.payload,
  });
  if (result.success) await assert_task_agent(params.storage, params.payload.title, params.context.agent.id);
  return result.success
    ? { success: true, data: { runs: result.runs ?? [] } as unknown as PowerJsonValue }
    : { success: false, error: result.error || "task history failed" };
}

/** 执行 `task.run_detail` action。 */
export async function execute_task_run_detail_action(params: {
  /** 当前 Power 执行上下文。 */
  readonly context: PowerContext;
  /** TaskPower 生命周期级统一存储。 */
  readonly storage: PowerStorage;
  /** 执行详情查询输入。 */
  readonly payload: TaskRunDetailRequest;
}) {
  const result = await read_task_run({
    storage: params.storage,
    request: params.payload,
  });
  if (result.success) await assert_task_agent(params.storage, params.payload.title, params.context.agent.id);
  return result.success && result.run
    ? { success: true, data: { run: result.run } as unknown as PowerJsonValue }
    : { success: false, error: result.error || "task run detail failed" };
}

/**
 * 执行 `task.create` action。
 */
export async function executeTaskCreateAction(params: {
  context: PowerContext;
  definitions: TaskDefinitionRepository;
  payload: TaskCreateRequest;
  call: PowerCallScope;
  reloadSchedulerAfterMutation: TaskSchedulerReloadPort;
}) {
  const payload = params.payload;
  const result = await createTaskDefinition({
    definitions: params.definitions,
    agent_id: params.context.agent.id,
    request: {
      ...payload,
      workspace_id: payload.workspace_id || params.context.workspace.id,
    },
    ...(params.call.session
      ? {
          delivery_session: {
            agent_id: params.context.agent.id,
            workspace_id: params.context.workspace.id,
            session_id: params.call.session.session_id,
            origin_type: params.call.session.origin.type,
          },
        }
      : {}),
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
    task_id: deriveTaskIdFromTitle(String(result.title || payload.title || "").trim()),
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
  context: PowerContext;
  definitions: TaskDefinitionRepository;
  payload: TaskRunRequest;
  executions: TaskExecutionCoordinator;
  notifications?: PowerNotificationPublisher;
  execution_context?: PowerExecutionContext;
  delivery: TaskCompletionDeliveryPort;
}) {
  const result = await runTaskDefinition({
    context: params.context,
    definitions: params.definitions,
    request: params.payload,
    executions: params.executions,
    notifications: params.notifications,
    execution_context: params.execution_context,
    delivery: params.delivery,
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
  context: PowerContext;
  definitions: TaskDefinitionRepository;
  payload: TaskDeleteRequest;
  notifications?: PowerNotificationPublisher;
  reloadSchedulerAfterMutation: TaskSchedulerReloadPort;
}) {
  const payload = params.payload;
  const result = await deleteTaskDefinition({
    definitions: params.definitions,
    request: payload,
    expected_agent_id: params.context.agent.id,
  });
  if (!result.success) {
    return {
      success: false,
      error: result.error || "task delete failed",
    };
  }
  await dismiss_task_notification(params.notifications, params.payload.title);
  const scheduler = await params.reloadSchedulerAfterMutation({
    context: params.context,
    action: "delete",
    title: String(result.title || payload.title || "").trim() || "unknown",
    task_id: deriveTaskIdFromTitle(payload.title),
  });
  return {
    success: true,
    data: {
      ...result,
      scheduler,
    },
  };
}

/** 删除 Task 时同步清除该业务对象仍未读取的完成通知。 */
async function dismiss_task_notification(notifications: PowerNotificationPublisher | undefined, title: string): Promise<void> {
  if (!notifications) return;
  try {
    await notifications.dismiss({ topic_key: `task:${deriveTaskIdFromTitle(title)}` });
  } catch {
    // 通知清理由宿主负责，失败不能改变已经完成的 Task 删除结果。
  }
}

/**
 * 执行 `task.update` action。
 */
export async function executeTaskUpdateAction(params: {
  context: PowerContext;
  definitions: TaskDefinitionRepository;
  payload: TaskUpdateRequest;
  reloadSchedulerAfterMutation: TaskSchedulerReloadPort;
}) {
  const payload = params.payload;
  const result = await updateTaskDefinition({
    definitions: params.definitions,
    request: payload,
    expected_agent_id: params.context.agent.id,
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
    task_id: deriveTaskIdFromTitle(payload.title),
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
  context: PowerContext;
  definitions: TaskDefinitionRepository;
  payload: TaskSetStatusRequest;
  reloadSchedulerAfterMutation: TaskSchedulerReloadPort;
}) {
  const payload = params.payload;
  const result = await setTaskStatus({
    definitions: params.definitions,
    request: payload,
    expected_agent_id: params.context.agent.id,
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
    task_id: deriveTaskIdFromTitle(payload.title),
  });
  return {
    success: true,
    data: {
      ...result,
      scheduler,
    },
  };
}

/** 保证 Agent action 只能读取或修改绑定到当前 Agent 的 Task。 */
async function assert_task_agent(storage: PowerStorage, title: string, agent_id: string): Promise<void> {
  const task_id = await resolveTaskIdByTitle({ storage, title });
  const task = await readTask({ storage, taskId: task_id });
  if (task.frontmatter.agent_id !== agent_id) {
    throw new Error(`Task belongs to another Agent: ${task.frontmatter.agent_id}`);
  }
}
