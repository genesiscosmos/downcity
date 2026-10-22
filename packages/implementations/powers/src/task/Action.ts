/**
 * Task command services.
 *
 * 关键点（中文）
 * - 任务定义（task.toml）与执行（runTaskNow）统一收口到服务层
 * - CLI 与 Server 共用同一份参数归一化/校验逻辑
 */

import { randomUUID } from "node:crypto";
import { validate_task_schedule } from "./application/TaskScheduleValidation.js";
import type { ShipTaskStatus, TaskDeliverySession } from "./types/Task.js";
import type { PowerContext } from "@downcity/city/power";
import type { StepSnapshot } from "@downcity/city/power";
import type { PowerJsonValue } from "@downcity/city/power";
import type { PowerStorage } from "@downcity/city/power";
import {
  normalizeTaskKind,
  normalizeTaskWhen,
  normalizeTaskSchedule,
} from "./runtime/Model.js";
import {
  deleteTask,
  inspect_task_definitions,
  readTask,
  resolveTaskIdByTitle,
  writeTask,
} from "./runtime/Store.js";
import { runTaskNow } from "./runtime/Runner.js";
import { normalize_task_state, task_work_is_closed, task_is_recurring, task_occurrence_key } from "./runtime/TaskWorkflowModel.js";
import { register_task_occurrence, settle_task_execution, save_task_workflow } from "./runtime/TaskWorkflowState.js";
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
import type { TaskDefinitionRepository } from "./runtime/TaskDefinitionRepository.js";
import type { TaskCompletionDeliveryPort } from "./types/TaskRunner.js";

function resolveTaskSchedule(input: PowerJsonValue | undefined, fallback: ShipTaskStatus): ShipTaskStatus {
  const normalized = normalizeTaskSchedule(input);
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
    "- 如果任务需要通知外部渠道，由执行任务的 Agent 自己调用 messenger power。",
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
    "- 任务运行记录由 Task Power 统一保存；需要交付给用户的文件应明确写入项目目录。",
    "- 任务完成结果写入关联 Session 的 assistant 消息，不会替 Agent 调用 messenger power。",
    "",
  ].join("\n");
}


export async function listTaskDefinitions(params: {
  storage: PowerStorage;
  /** 只返回指定执行 Agent 的 Task；省略时返回 City 中全部 Task。 */
  agent_id?: string;
  status?: ShipTaskStatus;
}): Promise<TaskListResponse> {
  const normalizedStatus = normalizeTaskSchedule(params.status);

  const inspection = await inspect_task_definitions(params.storage);
  const agent_id = String(params.agent_id || "").trim();
  const filtered = inspection.tasks.filter((task) =>
    (!agent_id || task.agent_id === agent_id || task.kind === "user")
    && (!normalizedStatus || task.schedule === normalizedStatus));

  return {
    success: true,
    issues: inspection.issues,
    tasks: filtered.map((task) => ({
      task_id: task.taskId,
      workflow: task.workflow,
      title: task.title,
      ...(typeof task.body === "string" && task.body.trim()
        ? { body: task.body }
        : {}),
      when: task.when,
      schedule: task.schedule,
      agent_id: task.agent_id,
      workspace_id: task.workspace_id,
      ...(task.delivery_session ? { delivery_session: task.delivery_session } : {}),
      kind: task.kind,
      ...(task.kind === "agent" ? { review: Boolean(task.review) } : {}),
      taskPath: task.taskPath,
      ...(task.last_run_at ? { last_run_at: task.last_run_at } : {}),
    })),
  };
}

/** 读取一个 Task 的全部执行记录。 */
export async function list_task_run_history(params: {
  /** TaskPower 生命周期级统一存储。 */
  readonly storage: PowerStorage;
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
  /** TaskPower 生命周期级统一存储。 */
  readonly storage: PowerStorage;
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
  definitions: TaskDefinitionRepository;
  /** 新 Task 唯一绑定的执行 Agent。 */
  agent_id: string;
  request: TaskCreateRequest;
  /** 由 Power 调用上下文捕获的固定结果交付 Session。 */
  delivery_session?: TaskDeliverySession;
}): Promise<TaskCreateResponse> {
  const req = params.request;

  const title = String(req.title || "").trim();
  const agent_id = String(params.agent_id || "").trim();
  const workspace_id = String(req.workspace_id || "").trim();
  const taskId = `task_${randomUUID()}`;
  const whenNormalized = normalizeTaskWhen(String(req.when || "@manual").trim() || "@manual");
  const kind = normalizeTaskKind(req.kind);

  if (!title) return { success: false, error: "Missing title" };
  if (kind !== "user" && !agent_id) return { success: false, error: "Missing agent_id" };
  if (kind !== "user" && !workspace_id) return { success: false, error: "Missing workspace_id" };
  if (!whenNormalized.ok) return { success: false, error: whenNormalized.error };
  try {
    validate_task_schedule(whenNormalized.value);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  const schedule = resolveTaskSchedule(req.schedule, "enabled");
  const body =
    typeof req.body === "string" && req.body.trim()
      ? req.body.trim()
      : kind === "script" || kind === "user"
        ? ""
        : buildDefaultTaskBody();
  if (kind !== "user" && !body) return { success: false, error: "Missing body" };
  try {
    return await params.definitions.mutate(async (storage) => {
      // 标题是可编辑内容，重复标题不合并任务；稳定身份由创建时生成。
      const target_task_id = taskId;
      const written = await writeTask({
        taskId: target_task_id,
        storage,
        overwrite: false,
        task: {
          taskId: target_task_id,
          title,
          when: validate_task_schedule(whenNormalized.value),
          agent_id: kind === "user" ? "" : agent_id,
          workspace_id: kind === "user" ? "" : workspace_id,
          ...(params.delivery_session
            ? { delivery_session: params.delivery_session }
            : {}),
          kind,
          ...(kind === "agent" && req.review === true ? { review: true } : {}),
          body,
          workflow: normalize_task_state({ organized: kind !== "user", ...(whenNormalized.value.startsWith("time:") ? { planned_at: whenNormalized.value.slice(5) } : {}), progress: whenNormalized.value !== "@manual" && !whenNormalized.value.startsWith("time:") ? "in_progress" : "pending" }),
          schedule,
          taskPath: "",
        },
      });
      return {
        success: true,
        task_id: target_task_id,
        title,
        taskPath: written.taskPath,
      };
    });
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

export async function updateTaskDefinition(params: {
  definitions: TaskDefinitionRepository;
  request: TaskUpdateRequest;
  /** 仅允许修改该执行 Agent 当前持有的 Task；宿主管理入口省略。 */
  expected_agent_id?: string;
}): Promise<TaskUpdateResponse> {
  const req = params.request;
  const title = String(req.title || "").trim();

  // 关键点（中文）：API 层也做一次互斥校验，避免非 CLI 调用写入歧义状态。
  if (req.body !== undefined && req.clearBody) {
    return { success: false, error: "`body` conflicts with `clearBody`" };
  }
  if (req.when !== undefined && req.clearWhen) {
    return { success: false, error: "`when` conflicts with `clearWhen`" };
  }

  try {
    return await params.definitions.mutate(async (storage) => {
      const task_id = await resolveTaskIdByTitle({ storage, title });
      const current = await readTask({ storage, taskId: task_id });
      if (
        params.expected_agent_id
        && current.kind !== "user"
        && current.agent_id !== params.expected_agent_id
      ) {
        throw new Error(`Task belongs to another Agent: ${current.agent_id}`);
      }

      const nextTitle =
        typeof req.titleNext === "string"
          ? req.titleNext.trim()
          : current.title;
      if (!nextTitle) return { success: false, error: "title cannot be empty" };
      if (params.definitions.is_running(task_id)) throw new Error("运行期间不能修改任务定义");

      const whenInput = req.clearWhen
        ? "@manual"
        : typeof req.when === "string"
          ? req.when.trim()
          : current.when;
      const whenNormalized = normalizeTaskWhen(whenInput);
      if (!whenNormalized.ok) return { success: false, error: whenNormalized.error };

      const workspace_id = typeof req.workspace_id === "string"
        ? req.workspace_id.trim()
        : current.workspace_id;
      if (current.kind !== "user" && !workspace_id) return { success: false, error: "workspace_id cannot be empty" };
      const agent_id = typeof req.agent_id === "string"
        ? req.agent_id.trim()
        : current.agent_id;
      if (current.kind !== "user" && !agent_id) return { success: false, error: "agent_id cannot be empty" };
      const kind = normalizeTaskKind(
        req.kind === undefined ? current.kind : req.kind,
      );
      const review =
        kind === "agent"
          ? req.review === undefined
            ? Boolean(current.review)
            : req.review === true
          : false;

      const schedule =
        req.schedule === undefined
          ? current.schedule
          : normalizeTaskSchedule(req.schedule);
      if (!schedule) {
        return {
          success: false,
          error: `Invalid schedule: ${String(req.schedule)}`,
        };
      }

      const body = req.clearBody
        ? ""
        : typeof req.body === "string"
          ? req.body.trim()
          : current.body;

      const written = await writeTask({
        storage,
        taskId: task_id,
        overwrite: true,
        task: {
          ...current,
          title: nextTitle,
          when: whenNormalized.value,
          agent_id,
          workspace_id,
          kind,
          ...(kind === "agent" && review ? { review: true } : {}),
          body,
          schedule,
        },
      });

      return {
        success: true,
        task_id,
        title: nextTitle,
        taskPath: written.taskPath,
      };
    });
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

export async function runTaskDefinition(params: {
  context: PowerContext;
  definitions: TaskDefinitionRepository;
  request: TaskRunRequest;
  executions: TaskExecutionCoordinator;
  notifications?: import("@downcity/city/power").PowerNotificationPublisher;
  execution_context?: StepSnapshot;
  delivery: TaskCompletionDeliveryPort;
}): Promise<TaskRunResponse> {
  const title = String(params.request.title || "").trim();
  let taskId = "";
  try {
    taskId = await resolveTaskIdByTitle({ storage: params.definitions.storage, title });
  } catch (error) {
    return { success: false, error: String(error) };
  }
  const reason = typeof params.request.reason === "string" ? params.request.reason.trim() : "";
  const trigger = params.request.scheduler_trigger
    ? { type: params.request.scheduler_trigger }
    : { type: "manual" as const, ...(reason ? { reason } : {}) };

  try {
    // 关键点（中文）：run 改为“异步受理”，先做存在性校验，再后台执行。
    const executionId = `${taskId}:${Date.now()}`;
    const accepted = await params.definitions.mutate(async (storage) => {
      const task = await readTask({ taskId, storage });
      // 调度读取与受理之间允许用户修改，旧回调必须在事务内退出。
      if (trigger.type !== "manual" && (
        task.schedule !== "enabled"
        || task_work_is_closed(task)
        || !params.request.expected_when
        || task.when !== params.request.expected_when
        || (trigger.type === "time" ? !task.when.startsWith("time:") : !task_is_recurring(task))
      )) return false;
      if (task.agent_id !== params.context.agent.id) {
        throw new Error(`Task Agent mismatch: expected ${task.agent_id}, got ${params.context.agent.id}`);
      }
      const workspace = params.context.workspace;
      if (!workspace) throw new Error("Task execution requires a Workspace");
      if (task.workspace_id !== workspace.id) {
        throw new Error(`Task Workspace mismatch: expected ${task.workspace_id}, got ${workspace.id}`);
      }
      if (task.preparing && task.preparing.status !== "ready") throw new Error("任务尚未准备完成，请先补充或编辑任务");
      if (task.kind === "user") throw new Error("个人待办不需要 Agent 执行");
      if (task_work_is_closed(task)) throw new Error("请先重新打开已完成或已取消的任务");
      if (params.definitions.is_running(taskId)) {
        if (trigger.type === "cron") {
          const state = normalize_task_state(task.workflow);
          const at = new Date();
          const occurrence_id = task_occurrence_key(task, at);
          if (!state.occurrences.some((item) => item.occurrence_id === occurrence_id)) {
            state.occurrences.push({ occurrence_id, planned_at: at.toISOString(), status: "skipped" });
            task.workflow = state;
            await save_task_workflow(params.definitions, task);
          }
        }
        return false;
      }
      const workflow = normalize_task_state(task.workflow);
      workflow.progress = "in_progress";
      workflow.organized = true;
      workflow.active_execution_id = executionId;
      task.workflow = workflow;
      if (trigger.type !== "manual" && !register_task_occurrence(task, new Date(), executionId)) return false;
      const state = normalize_task_state(task.workflow);
      if (trigger.type === "manual" && task_is_recurring(task)) {
        const occurrence = params.request.occurrence_id ? state.occurrences.find((item) => item.occurrence_id === params.request.occurrence_id) : undefined;
        if (params.request.occurrence_id && (!occurrence || occurrence.status !== "pending")) throw new Error("只能重试尚未完成的周期发生项");
        if (occurrence) { occurrence.status = "in_progress"; occurrence.execution_id = executionId; }
        else state.occurrences.push({ occurrence_id: executionId, planned_at: new Date().toISOString(), status: "in_progress", execution_id: executionId });
      }
      // 用户明确重新执行时，前一次的失败或验收请求退出待处理，不覆盖其他周期事项。
      state.inbox.filter((item) => !task_is_recurring(task) || item.occurrence_id === params.request.occurrence_id).forEach((item) => { item.resolved = true; });
      task.workflow = state;
      // 提前手动执行替代本次一次性安排，旧回调在受理检查中退出。
      if (trigger.type === "manual" && task.when.startsWith("time:")) {
        task.schedule = "paused";
      }
      await save_task_workflow(params.definitions, task);
      return params.executions.start(taskId, async () => {
        await runTaskNow({
          context: params.context,
          storage,
          taskId,
          task_snapshot: task,
          trigger,
          executionId,
          notifications: params.notifications,
          delivery: params.delivery,
          ...(params.execution_context?.workspace_env
            ? { workspace_env: { ...params.execution_context.workspace_env } }
            : {}),
          ...(params.execution_context?.agent_systems
            ? { agent_systems: [...params.execution_context.agent_systems] }
            : {}),
        })
        .then(async (result) => {
          await settle_task_execution({ definitions: params.definitions, task, execution_id: executionId,
            success: result.status === "success" && result.resultStatus !== "invalid", timestamp: result.timestamp,
            ...(result.resultErrors.length ? { error: result.resultErrors.join("; ") } : {}),
          });
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
        .catch(async (error) => {
          await settle_task_execution({ definitions: params.definitions, task, execution_id: executionId, success: false, error: String(error) });
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
    });

    if (!accepted) {
      return {
        success: true,
        accepted: false,
        message: "The task is already running.",
        title,
      };
    }

    params.context.logger.info(
      formatTaskLogMessage("Task run accepted"),
      {
        taskId,
        via: trigger.type,
        ...(reason ? { reason } : {}),
      },
    );

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
  definitions: TaskDefinitionRepository;
  request: TaskSetStatusRequest;
  /** 仅允许修改该执行 Agent 当前持有的 Task；宿主管理入口省略。 */
  expected_agent_id?: string;
}): Promise<TaskSetStatusResponse> {
  const title = String(params.request.title || "").trim();
  const status = normalizeTaskSchedule(params.request.status);

  if (!status) {
    return {
      success: false,
      error: `Invalid status: ${String(params.request.status)}`,
    };
  }

  try {
    return await params.definitions.mutate(async (storage) => {
      const task_id = await resolveTaskIdByTitle({ storage, title });
      const task = await readTask({ storage, taskId: task_id });
      if (
        params.expected_agent_id
        && task.agent_id !== params.expected_agent_id
      ) {
        throw new Error(`Task belongs to another Agent: ${task.agent_id}`);
      }

      await writeTask({
        storage,
        taskId: task_id,
        overwrite: true,
        task: { ...task, schedule: status },
      });

      return {
        success: true,
        task_id,
        title: task.title,
        status,
      };
    });
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

export async function deleteTaskDefinition(params: {
  definitions: TaskDefinitionRepository;
  request: TaskDeleteRequest;
  /** 仅允许删除该执行 Agent 当前持有的 Task；宿主管理入口省略。 */
  expected_agent_id?: string;
}): Promise<TaskDeleteResponse> {
  const title = String(params.request.title || "").trim();

  try {
    return await params.definitions.mutate(async (storage) => {
      const task_id = await resolveTaskIdByTitle({ storage, title });
      const task = await readTask({ storage, taskId: task_id });
      if (
        params.expected_agent_id
        && task.agent_id !== params.expected_agent_id
      ) {
        throw new Error(`Task belongs to another Agent: ${task.agent_id}`);
      }
      if (params.definitions.is_running(task_id)) {
        throw new Error(`Task is running and cannot be deleted: ${title}`);
      }
      const deleted = await deleteTask({
        storage,
        taskId: task_id,
      });
      return {
        success: true,
        task_id,
        title,
        taskDirPath: deleted.taskDirPath,
      };
    });
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}
