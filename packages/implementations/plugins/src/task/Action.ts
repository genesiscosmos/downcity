/**
 * Task command services.
 *
 * 关键点（中文）
 * - 任务定义（task.md）与执行（runTaskNow）统一收口到服务层
 * - CLI 与 Server 共用同一份参数归一化/校验逻辑
 */

import type { ShipTaskStatus, TaskDeliverySession } from "./types/Task.js";
import type { PluginContext } from "@downcity/city/plugin";
import type { PluginExecutionContext } from "@downcity/city/plugin";
import type { PluginJsonValue } from "@downcity/city/plugin";
import type { PluginStorage } from "@downcity/city/plugin";
import {
  deriveTaskIdFromTitle,
  normalizeTaskId,
} from "./runtime/Paths.js";
import {
  normalizeTaskKind,
  normalizeTaskWhen,
  normalizeTaskStatus,
} from "./runtime/Model.js";
import {
  deleteTask,
  listTasks,
  readTask,
  resolveTaskIdByTitle,
  writeTask,
} from "./runtime/Store.js";
import { runTaskNow } from "./runtime/Runner.js";
import { list_task_runs, read_task_run_detail } from "./runtime/TaskRunStore.js";
import type {
  TaskCreateRequest,
  TaskCreateResponse,
  TaskDeleteRequest,
  TaskDeleteResponse,
  TaskListResponse,
  TaskRunDetailRequest,
  TaskRunDetailResponse,
  TaskRunHistoryRequest,
  TaskRunHistoryResponse,
  TaskRunRequest,
  TaskRunResponse,
  TaskUpdateRequest,
  TaskUpdateResponse,
  TaskSetStatusRequest,
  TaskSetStatusResponse,
} from "./types/TaskCommand.js";
import type { TaskExecutionCoordinator } from "./runtime/TaskExecutionCoordinator.js";

function resolveTaskStatus(input: PluginJsonValue | undefined, fallback: ShipTaskStatus): ShipTaskStatus {
  const normalized = normalizeTaskStatus(input);
  return normalized || fallback;
}

const TASK_LOG_PREFIX = "[TASK]";

function formatTaskLogMessage(message: string): string {
  return `${TASK_LOG_PREFIX} ${message}`;
}

function buildDefaultTaskBody(): string {
  return [
    "# 任务目标",
    "",
    "- 明确这次任务最终要交付什么结果，任务完成后结果会写入任务关联的 Session。",
    "- 如果需要向用户交付额外文件，请写入明确的项目路径。",
    "",
    "# 背景与输入",
    "",
    "- 补充任务依赖的上下文、数据来源、范围限制与关键假设。",
    "- 如果存在用户原话、链接、文件路径或口径要求，在这里写清楚。",
    "",
    "# 执行步骤",
    "",
    "1. 先理解任务目标与完成标准。",
    "2. 按需要收集信息、执行分析或运行命令。",
    "3. 需要文件交付时，把产物写入明确的项目路径。",
    "4. 整理出面向用户可直接阅读的最终结果。",
    "",
    "# 输出要求",
    "",
    "- 最终输出直接写结果本身，不要包多余寒暄，不要粘贴冗长日志。",
    "- 需要结构时，优先使用短标题、要点列表、表格或 JSON 等稳定格式。",
    "- 如果任务需要通知外部渠道，由执行任务的 Agent 自己调用 chat plugin。",
    "",
    "# 触发与状态建议",
    "",
    "- 默认创建后会立即启用；如果还在试运行或需要人工确认，再改成 `paused`。",
    "- 已经稳定、需要周期执行的任务：优先保持 `enabled`，再改成 cron。",
    "- 一次性定时任务：使用 `time:<带时区的 ISO 时间>`；执行后会自动回退为 `@manual` + `paused`。",
    "",
    "# 注意事项",
    "",
    "- 当前是独立 task 上下文，不要假设仍处在原始聊天回合里。",
    "- 任务运行记录由 Task Plugin 统一保存；需要交付给用户的文件应明确写入项目目录。",
    "- 任务完成结果写入关联 Session 的 assistant 消息，不会替 Agent 调用 chat plugin。",
    "",
  ].join("\n");
}


export async function listTaskDefinitions(params: {
  storage: PluginStorage;
  /** 只返回指定执行 Agent 的 Task；省略时返回 City 中全部 Task。 */
  agent_id?: string;
  status?: ShipTaskStatus;
}): Promise<TaskListResponse> {
  const normalizedStatus = normalizeTaskStatus(params.status);

  const tasks = await listTasks(params.storage);
  const agent_id = String(params.agent_id || "").trim();
  const filtered = tasks.filter((task) =>
    (!agent_id || task.agent_id === agent_id)
    && (!normalizedStatus || String(task.status).toLowerCase() === normalizedStatus));

  return {
    success: true,
    tasks: filtered.map((task) => ({
      title: task.title,
      description: task.description,
      ...(typeof task.body === "string" && task.body.trim()
        ? { body: task.body }
        : {}),
      when: task.when,
      status: task.status,
      agent_id: task.agent_id,
      workspace_id: task.workspace_id,
      ...(task.delivery_session ? { delivery_session: task.delivery_session } : {}),
      kind: task.kind || "agent",
      ...(task.kind === "agent" ? { review: Boolean(task.review) } : {}),
      taskMdPath: task.taskMdPath,
      ...(task.lastRunTimestamp ? { lastRunTimestamp: task.lastRunTimestamp } : {}),
    })),
  };
}

/** 读取一个 Task 的全部执行记录。 */
export async function list_task_run_history(params: {
  /** TaskPlugin 生命周期级统一存储。 */
  readonly storage: PluginStorage;
  /** 执行记录查询输入。 */
  readonly request: TaskRunHistoryRequest;
}): Promise<TaskRunHistoryResponse> {
  const title = String(params.request.title || "").trim();
  if (!title) return { success: false, error: "Missing title" };
  try {
    const task_id = await resolveTaskIdByTitle({ storage: params.storage, title });
    await readTask({ taskId: task_id, storage: params.storage });
    return { success: true, runs: await list_task_runs({ storage: params.storage, task_id }) };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/** 读取一条 Task 执行记录及其用户可见产物。 */
export async function read_task_run(params: {
  /** TaskPlugin 生命周期级统一存储。 */
  readonly storage: PluginStorage;
  /** 执行详情查询输入。 */
  readonly request: TaskRunDetailRequest;
}): Promise<TaskRunDetailResponse> {
  const title = String(params.request.title || "").trim();
  const timestamp = String(params.request.timestamp || "").trim();
  if (!title) return { success: false, error: "Missing title" };
  if (!timestamp) return { success: false, error: "Missing timestamp" };
  try {
    const task_id = await resolveTaskIdByTitle({ storage: params.storage, title });
    await readTask({ taskId: task_id, storage: params.storage });
    return {
      success: true,
      run: await read_task_run_detail({ storage: params.storage, task_id, timestamp }),
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function createTaskDefinition(params: {
  storage: PluginStorage;
  /** 新 Task 唯一绑定的执行 Agent。 */
  agent_id: string;
  request: TaskCreateRequest;
  /** 由 Plugin 调用上下文捕获的固定结果交付 Session。 */
  delivery_session?: TaskDeliverySession;
}): Promise<TaskCreateResponse> {
  const req = params.request;

  const title = String(req.title || "").trim();
  const description = String(req.description || "").trim();
  const agent_id = String(params.agent_id || "").trim();
  const workspace_id = String(req.workspace_id || "").trim();
  let taskIdFromName = "";
  let taskId = "";
  try {
    taskIdFromName = deriveTaskIdFromTitle(title);
    taskId = normalizeTaskId(taskIdFromName);
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
  const whenNormalized = normalizeTaskWhen(String(req.when || "@manual").trim() || "@manual");
  const kind = normalizeTaskKind(req.kind);

  if (!title) return { success: false, error: "Missing title" };
  if (!description) return { success: false, error: "Missing description" };
  if (!agent_id) return { success: false, error: "Missing agent_id" };
  if (!workspace_id) return { success: false, error: "Missing workspace_id" };
  if (!whenNormalized.ok) return { success: false, error: whenNormalized.error };

  const status = resolveTaskStatus(req.status, "enabled");
  const body =
    typeof req.body === "string" && req.body.trim()
      ? req.body.trim()
      : kind === "script"
        ? ""
        : buildDefaultTaskBody();
  // 关键点（中文）：`title` 是唯一键，create 去重只按 title 精确匹配。
  const existingTasks = await listTasks(params.storage);
  const duplicated = existingTasks.find((item) => String(item.title || "").trim() === title);
  if (duplicated && duplicated.agent_id !== agent_id) {
    return {
      success: false,
      error: `Task title already belongs to another Agent: ${duplicated.agent_id}`,
    };
  }
  if (duplicated && !req.overwrite) {
    return {
      success: true,
      title: duplicated.title,
      taskMdPath: duplicated.taskMdPath,
      reusedExisting: true,
      message: "Task title already exists; reused existing task.",
    };
  }
  const targetTaskId = duplicated ? duplicated.taskId : taskId;

  try {
    const written = await writeTask({
      taskId: targetTaskId,
      storage: params.storage,
      overwrite: Boolean(req.overwrite) || Boolean(duplicated),
      frontmatter: {
        title,
        description,
        when: whenNormalized.value,
        agent_id,
        workspace_id,
        ...(params.delivery_session
          ? { delivery_session: params.delivery_session }
          : {}),
        kind,
        ...(kind === "agent" && req.review === true ? { review: true } : {}),
        status,
      },
      body,
    });

    return {
      success: true,
      title,
      taskMdPath: written.taskMdPath,
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

export async function updateTaskDefinition(params: {
  storage: PluginStorage;
  request: TaskUpdateRequest;
}): Promise<TaskUpdateResponse> {
  const req = params.request;
  const title = String(req.title || "").trim();
  let taskId = "";
  try {
    taskId = await resolveTaskIdByTitle({ storage: params.storage, title });
  } catch (error) {
    return { success: false, error: String(error) };
  }

  // 关键点（中文）：API 层也做一次互斥校验，避免非 CLI 调用写入歧义状态。
  if (req.body !== undefined && req.clearBody) {
    return { success: false, error: "`body` conflicts with `clearBody`" };
  }
  if (req.when !== undefined && req.clearWhen) {
    return { success: false, error: "`when` conflicts with `clearWhen`" };
  }

  try {
    const current = await readTask({
      storage: params.storage,
      taskId,
    });

    const nextTitle =
      typeof req.titleNext === "string"
        ? req.titleNext.trim()
        : current.frontmatter.title;
    if (!nextTitle) return { success: false, error: "title cannot be empty" };
    const nextTaskId = normalizeTaskId(deriveTaskIdFromTitle(nextTitle));
    if (nextTaskId !== taskId) {
      return {
        success: false,
        error: `title cannot change task identity. Expected "${taskId}", got "${nextTaskId}".`,
      };
    }

    const description =
      typeof req.description === "string"
        ? req.description.trim()
        : current.frontmatter.description;
    if (!description) return { success: false, error: "description cannot be empty" };

    const whenInput = req.clearWhen
      ? "@manual"
      : typeof req.when === "string"
        ? req.when.trim()
        : current.frontmatter.when;
    const whenNormalized = normalizeTaskWhen(whenInput);
    if (!whenNormalized.ok) return { success: false, error: whenNormalized.error };

    const workspace_id = typeof req.workspace_id === "string"
      ? req.workspace_id.trim()
      : current.frontmatter.workspace_id;
    if (!workspace_id) return { success: false, error: "workspace_id cannot be empty" };
    const agent_id = typeof req.agent_id === "string"
      ? req.agent_id.trim()
      : current.frontmatter.agent_id;
    if (!agent_id) return { success: false, error: "agent_id cannot be empty" };
    const kind = normalizeTaskKind(
      req.kind === undefined ? current.frontmatter.kind : req.kind,
    );
    const review =
      kind === "agent"
        ? req.review === undefined
          ? Boolean(current.frontmatter.review)
          : req.review === true
        : false;

    const status =
      req.status === undefined
        ? current.frontmatter.status
        : normalizeTaskStatus(req.status);
    if (!status) {
      return {
        success: false,
        error: `Invalid status: ${String(req.status)}`,
      };
    }

    const body = req.clearBody
      ? ""
      : typeof req.body === "string"
        ? req.body.trim()
        : current.body;

    const written = await writeTask({
      storage: params.storage,
      taskId,
      overwrite: true,
      frontmatter: {
        title: nextTitle,
        description,
        when: whenNormalized.value,
        agent_id,
        workspace_id,
        ...(current.frontmatter.delivery_session
          ? { delivery_session: current.frontmatter.delivery_session }
          : {}),
        kind,
        ...(kind === "agent" && review ? { review: true } : {}),
        status,
      },
      body,
    });

    return {
      success: true,
      title: nextTitle,
      taskMdPath: written.taskMdPath,
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

export async function runTaskDefinition(params: {
  context: PluginContext;
  storage: PluginStorage;
  request: TaskRunRequest;
  executions: TaskExecutionCoordinator;
  notifications?: import("@downcity/city/plugin").PluginNotificationPublisher;
  execution_context?: PluginExecutionContext;
}): Promise<TaskRunResponse> {
  const title = String(params.request.title || "").trim();
  let taskId = "";
  try {
    taskId = await resolveTaskIdByTitle({ storage: params.storage, title });
  } catch (error) {
    return { success: false, error: String(error) };
  }
  const reason = typeof params.request.reason === "string" ? params.request.reason.trim() : "";
  const trigger = params.request.scheduler_trigger
    ? { type: params.request.scheduler_trigger }
    : { type: "manual" as const, ...(reason ? { reason } : {}) };

  try {
    // 关键点（中文）：run 改为“异步受理”，先做存在性校验，再后台执行。
    const task = await readTask({
      taskId,
      storage: params.storage,
    });
    if (task.frontmatter.agent_id !== params.context.agent.id) {
      throw new Error(`Task Agent mismatch: expected ${task.frontmatter.agent_id}, got ${params.context.agent.id}`);
    }
    if (task.frontmatter.workspace_id !== params.context.workspace.id) {
      throw new Error(`Task Workspace mismatch: expected ${task.frontmatter.workspace_id}, got ${params.context.workspace.id}`);
    }

    params.context.logger.info(
      formatTaskLogMessage("Task run accepted"),
      {
        taskId,
        via: trigger.type,
        ...(reason ? { reason } : {}),
      },
    );

    const executionId = `${taskId}:${Date.now()}`;
    const accepted = params.executions.start(taskId, async () => {
      await runTaskNow({
        context: params.context,
        storage: params.storage,
        taskId,
        trigger,
        executionId,
        notifications: params.notifications,
        ...(params.execution_context?.workspace_env
          ? { workspace_env: { ...params.execution_context.workspace_env } }
          : {}),
        ...(params.execution_context?.agent_systems
          ? { agent_systems: [...params.execution_context.agent_systems] }
          : {}),
      })
      .then((result) => {
        params.context.logger.info(
          formatTaskLogMessage("Task run finished"),
          {
            taskId,
            via: trigger.type,
            status: result.status,
            executionStatus: result.executionStatus,
            resultStatus: result.resultStatus,
            ...(result.resultErrors.length > 0
              ? { resultErrors: result.resultErrors }
              : {}),
            dialogueRounds: result.dialogueRounds,
            userSimulatorSatisfied: result.userSimulatorSatisfied,
            executionId: result.executionId,
            timestamp: result.timestamp,
            runDir: result.runDirRel,
          },
        );
      })
      .catch((error) => {
        params.context.logger.error(
          formatTaskLogMessage("Task run failed"),
          {
            taskId,
            via: trigger.type,
            error: String(error),
          },
        );
      });
    });

    if (!accepted) {
      return {
        success: true,
        accepted: false,
        message: "The task is already running.",
        title,
      };
    }

    return {
      success: true,
      accepted: true,
      // 关键点（中文）：这里直接返回给 agent 作为 tool result，提醒它这是异步任务，无需等待完成即可继续后续流程。
      message: "The task has started. Its result will be available in Task history and, when configured, appended to the associated Session. Continue the current flow without waiting for completion.",
      executionId,
      title,
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

export async function setTaskStatus(params: {
  storage: PluginStorage;
  request: TaskSetStatusRequest;
}): Promise<TaskSetStatusResponse> {
  const title = String(params.request.title || "").trim();
  let taskId = "";
  try {
    taskId = await resolveTaskIdByTitle({ storage: params.storage, title });
  } catch (error) {
    return { success: false, error: String(error) };
  }
  const status = normalizeTaskStatus(params.request.status);

  if (!status) {
    return {
      success: false,
      error: `Invalid status: ${String(params.request.status)}`,
    };
  }

  try {
    const task = await readTask({
      storage: params.storage,
      taskId,
    });

    await writeTask({
      storage: params.storage,
      taskId,
      overwrite: true,
      frontmatter: {
        ...task.frontmatter,
        status,
      },
      body: task.body,
    });

    return {
      success: true,
      title: task.frontmatter.title,
      status,
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

export async function deleteTaskDefinition(params: {
  storage: PluginStorage;
  request: TaskDeleteRequest;
}): Promise<TaskDeleteResponse> {
  const title = String(params.request.title || "").trim();
  let taskId = "";
  try {
    taskId = await resolveTaskIdByTitle({ storage: params.storage, title });
  } catch (error) {
    return { success: false, error: String(error) };
  }

  try {
    const deleted = await deleteTask({
      storage: params.storage,
      taskId,
    });
    return {
      success: true,
      title,
      taskDirPath: deleted.taskDirPath,
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}
