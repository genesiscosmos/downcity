/**
 * Task command services.
 *
 * 关键点（中文）
 * - 任务定义（task.md）与执行（runTaskNow）统一收口到服务层
 * - CLI 与 Server 共用同一份参数归一化/校验逻辑
 */

import path from "node:path";
import type { ShipTaskStatus } from "./types/Task.js";
import type { PluginContext } from "@downcity/agent";
import type { PluginRunContext } from "@downcity/agent";
import type { JsonValue } from "@downcity/agent";
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
import type {
  TaskCreateRequest,
  TaskCreateResponse,
  TaskDeleteRequest,
  TaskDeleteResponse,
  TaskListResponse,
  TaskRunRequest,
  TaskRunResponse,
  TaskUpdateRequest,
  TaskUpdateResponse,
  TaskSetStatusRequest,
  TaskSetStatusResponse,
} from "./types/TaskCommand.js";

function resolveTaskStatus(input: JsonValue | undefined, fallback: ShipTaskStatus): ShipTaskStatus {
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
    "- 明确这次任务最终要交付什么结果，最终回复会由系统自动发送到任务绑定的 chat。",
    "- 如果需要额外文件，请写入本次 run 目录，便于审计和排查。",
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
    "3. 把关键中间产物写入 run 目录。",
    "4. 整理出面向用户可直接阅读的最终结果。",
    "",
    "# 输出要求",
    "",
    "- 最终输出直接写结果本身，不要包多余寒暄，不要粘贴冗长日志。",
    "- 需要结构时，优先使用短标题、要点列表、表格或 JSON 等稳定格式。",
    "- 默认不要在正文里重复调用 chat plugin 的发送 action；系统会自动发送最终结果。",
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
    "- 尽量使用可审计的方式：关键中间产物写入 `./.downcity/task/<title>/<timestamp>/` 下的 markdown 文件。",
    "- 如果任务明确要求跨会话、跨平台或发送额外通知，再显式调用 chat plugin 的发送 action。",
    "",
  ].join("\n");
}


export async function listTaskDefinitions(params: {
  project_root: string;
  status?: ShipTaskStatus;
}): Promise<TaskListResponse> {
  const root = path.resolve(params.project_root);
  const normalizedStatus = normalizeTaskStatus(params.status);

  const tasks = await listTasks(root);
  const filtered = normalizedStatus
    ? tasks.filter((task) => String(task.status).toLowerCase() === normalizedStatus)
    : tasks;

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
      session_id: task.session_id,
      kind: task.kind || "agent",
      ...(task.kind === "agent" ? { review: Boolean(task.review) } : {}),
      taskMdPath: task.taskMdPath,
      ...(task.lastRunTimestamp ? { lastRunTimestamp: task.lastRunTimestamp } : {}),
    })),
  };
}

export async function createTaskDefinition(params: {
  project_root: string;
  request: TaskCreateRequest;
}): Promise<TaskCreateResponse> {
  const root = path.resolve(params.project_root);
  const req = params.request;

  const title = String(req.title || "").trim();
  const description = String(req.description || "").trim();
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
  const session_id = String(req.session_id || "").trim();
  const kind = normalizeTaskKind(req.kind);

  if (!title) return { success: false, error: "Missing title" };
  if (!description) return { success: false, error: "Missing description" };
  if (!session_id) return { success: false, error: "Missing session_id" };
  if (!whenNormalized.ok) return { success: false, error: whenNormalized.error };

  const status = resolveTaskStatus(req.status, "enabled");
  const body =
    typeof req.body === "string" && req.body.trim()
      ? req.body.trim()
      : kind === "script"
        ? ""
        : buildDefaultTaskBody();
  // 关键点（中文）：`title` 是唯一键，create 去重只按 title 精确匹配。
  const existingTasks = await listTasks(root);
  const duplicated = existingTasks.find((item) => String(item.title || "").trim() === title);
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
      project_root: root,
      overwrite: Boolean(req.overwrite) || Boolean(duplicated),
      frontmatter: {
        title,
        description,
        when: whenNormalized.value,
        session_id,
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
  project_root: string;
  request: TaskUpdateRequest;
}): Promise<TaskUpdateResponse> {
  const root = path.resolve(params.project_root);
  const req = params.request;
  const title = String(req.title || "").trim();
  let taskId = "";
  try {
    taskId = await resolveTaskIdByTitle({ project_root: root, title });
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
      project_root: root,
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

    const session_id =
      typeof req.session_id === "string" ? req.session_id.trim() : current.frontmatter.session_id;
    if (!session_id) return { success: false, error: "session_id cannot be empty" };
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
      project_root: root,
      taskId,
      overwrite: true,
      frontmatter: {
        title: nextTitle,
        description,
        when: whenNormalized.value,
        session_id,
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
  project_root: string;
  request: TaskRunRequest;
  run_context?: PluginRunContext;
}): Promise<TaskRunResponse> {
  const root = path.resolve(params.project_root);
  const title = String(params.request.title || "").trim();
  let taskId = "";
  try {
    taskId = await resolveTaskIdByTitle({ project_root: root, title });
  } catch (error) {
    return { success: false, error: String(error) };
  }
  const reason = typeof params.request.reason === "string" ? params.request.reason.trim() : "";
  const trigger = {
    type: "manual" as const,
    ...(reason ? { reason } : {}),
  };

  try {
    // 关键点（中文）：run 改为“异步受理”，先做存在性校验，再后台执行。
    await readTask({
      taskId,
      project_root: root,
    });

    params.context.logger.info(
      formatTaskLogMessage("Manual task run accepted"),
      {
        taskId,
        via: "manual",
        ...(reason ? { reason } : {}),
      },
    );

    const executionId = `${taskId}:${Date.now()}`;
    void runTaskNow({
      context: params.context,
      project_root: root,
      taskId,
      trigger,
      executionId,
      ...(params.run_context?.workspace_env
        ? { workspace_env: { ...params.run_context.workspace_env } }
        : {}),
      ...(params.run_context?.agent_systems
        ? { agent_systems: [...params.run_context.agent_systems] }
        : {}),
    })
      .then((result) => {
        params.context.logger.info(
          formatTaskLogMessage("Manual task run finished"),
          {
            taskId,
            via: "manual",
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
          formatTaskLogMessage("Manual task run failed"),
          {
            taskId,
            via: "manual",
            error: String(error),
          },
        );
      });

    return {
      success: true,
      accepted: true,
      // 关键点（中文）：这里直接返回给 agent 作为 tool result，提醒它这是异步任务，无需等待完成即可继续后续流程。
      message: "The task has started. When it finishes, the task runtime will send the result to the user automatically. Continue the current flow without waiting for the task to complete.",
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
  project_root: string;
  request: TaskSetStatusRequest;
}): Promise<TaskSetStatusResponse> {
  const root = path.resolve(params.project_root);
  const title = String(params.request.title || "").trim();
  let taskId = "";
  try {
    taskId = await resolveTaskIdByTitle({ project_root: root, title });
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
      project_root: root,
      taskId,
    });

    await writeTask({
      project_root: root,
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
  project_root: string;
  request: TaskDeleteRequest;
}): Promise<TaskDeleteResponse> {
  const root = path.resolve(params.project_root);
  const title = String(params.request.title || "").trim();
  let taskId = "";
  try {
    taskId = await resolveTaskIdByTitle({ project_root: root, title });
  } catch (error) {
    return { success: false, error: String(error) };
  }

  try {
    const deleted = await deleteTask({
      project_root: root,
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
