/**
 * 统一任务工作区的宿主 API。
 *
 * 收件箱、待办和日历只操作 TaskPower 持有的聚合。所有 mutation 通过已有定义事务
 * 串行提交；真正执行继续委托 City 的 Agent/Workspace 动态范围。
 */
import { randomUUID } from "node:crypto";
import { validate_task_schedule } from "../application/TaskScheduleValidation.js";
import { getTaskPath } from "../runtime/Paths.js";
import { z } from "zod";
import type {
  PowerLifecycleContext,
  PowerJsonValue,
} from "@downcity/city/power";
import type { TaskPowerHostRuntime } from "../types/TaskPowerTypes.js";
import type { TaskWorkspaceSnapshot } from "../types/TaskWorkflow.js";
import {
  inspect_task_definitions,
  readTask,
  writeTask,
  deleteTask,
} from "../runtime/Store.js";
import { normalizeTaskWhen } from "../runtime/Model.js";
import {
  normalize_task_due,
  normalize_task_instant,
  normalize_task_state,
  task_is_recurring,
  task_occurrence_key,
} from "../runtime/TaskWorkflowModel.js";
import { save_task_workflow } from "../runtime/TaskWorkflowState.js";
import {
  list_task_runs_page,
  read_task_run_detail,
} from "../runtime/TaskRunStore.js";

const identity_schema = z.object({ task_id: z.string().min(1) });
const save_schema = z.object({
  create_id: z.uuid().optional(),
  task_id: z.string().min(1).optional(),
  title: z.string().trim().min(1),
  body: z.string().default(""),
  kind: z.enum(["user", "agent", "script"]).default("user"),
  agent_id: z.string().default(""),
  workspace_id: z.string().default(""),
  when: z.string().default("@manual"),
  schedule: z.enum(["enabled", "paused"]).default("paused"),
  organized: z.boolean().default(false),
  planned_at: z.string().optional(),
  planned_end_at: z.string().optional(),
  due_at: z.string().optional(),
  timezone: z.string().default("UTC"),
  require_acceptance: z.boolean().default(false),
  expected_revision: z.number().int().positive().optional(),
  start_now: z.boolean().optional(),
});
const command_schema = identity_schema.extend({
  command: z.enum([
    "organize",
    "start",
    "complete",
    "cancel",
    "reopen",
    "pause",
    "resume",
    "resolve",
    "accept",
    "revise",
    "skip",
  ]),
  item_id: z.string().optional(),
  occurrence_id: z.string().optional(),
  planned_at: z.string().optional(),
  feedback: z.string().trim().min(1).max(24000).optional(),
});

/** 注册统一工作区 actions，保持 Power 的单一存储所有权。 */
export function register_task_workspace_actions(
  context: PowerLifecycleContext,
  runtime: TaskPowerHostRuntime,
  generate_task?: (input: PowerJsonValue | undefined) => Promise<unknown>,
): ReadonlyMap<
  string,
  (input: PowerJsonValue | undefined) => Promise<PowerJsonValue>
> {
  const actions = new Map<
    string,
    (input: PowerJsonValue | undefined) => Promise<PowerJsonValue>
  >();
  const action = (
    id: string,
    run: (input: PowerJsonValue | undefined) => Promise<unknown>,
  ) => {
    const handler = async (input: PowerJsonValue | undefined) =>
      (await run(input)) as PowerJsonValue;
    actions.set(id, handler);
    context.power.action({ id, run: handler });
  };
  action(
    "workspace.snapshot",
    async () => await workspace_snapshot(context, runtime),
  );
  if (generate_task) action("generate", generate_task);
  action("workspace.reconcile", async (input) => {
    const { task_id } = identity_schema.parse(input);
    const task = await readTask({ storage: runtime.storage, taskId: task_id });
    const revision = task.preparing?.revision;
    if (task.preparing && task.preparing.status !== "ready") throw new Error("请先完成任务准备");
    const scheduler = await runtime.reconcile(task_id);
    await runtime.definitions.mutate(async (storage) => {
      const current = await readTask({ storage, taskId: task_id });
      const preparation = current.preparing;
      if (!preparation || preparation.revision !== revision || preparation.status !== "ready") return;
      current.preparing = { ...preparation, schedule_error: scheduler.reloaded ? undefined : scheduler.error || "自动安排同步失败" };
      await writeTask({ storage, taskId: task_id, task: current, overwrite: true });
    });
    return { task_id, scheduler };
  });
  action("workspace.save", async (input) => {
    const value = save_schema.parse(input);
    const normalized_when = normalizeTaskWhen(value.when);
    if (!normalized_when.ok) throw new Error(normalized_when.error);
    const planned_at = normalize_task_instant(value.planned_at);
    const due_at = normalize_task_due(value.due_at);
    const planned_end_at = normalize_task_instant(value.planned_end_at);
    if (planned_end_at && (!planned_at || Date.parse(planned_end_at) <= Date.parse(planned_at))) throw new Error("计划结束时间必须晚于计划开始时间");
    if (value.kind !== "user") {
      if (!value.agent_id || !value.workspace_id)
        throw new Error("请指定 Agent 和 Workspace");
      if (!value.body.trim()) throw new Error("请补充执行目标和说明");
      // 保存允许缺失的旧目标；实际启动时由 City 验证，用户仍可修复任务。
    }
    const task_id = value.task_id || `task_${value.create_id || randomUUID()}`;
    await runtime.definitions.mutate(async (storage) => {
      if (value.create_id && !value.task_id && await storage.files.path_exists(getTaskPath(storage.path!, task_id))) {
        const existing = await readTask({ storage, taskId: task_id });
        if (existing.title !== value.title || existing.body !== value.body.trim() || existing.kind !== value.kind || existing.agent_id !== (value.kind === "user" ? "" : value.agent_id) || existing.workspace_id !== (value.kind === "user" ? "" : value.workspace_id) || existing.when !== normalized_when.value || existing.workflow.timezone !== value.timezone || existing.workflow.due_at !== due_at || existing.workflow.planned_at !== planned_at || existing.workflow.planned_end_at !== planned_end_at || existing.workflow.require_acceptance !== value.require_acceptance || existing.schedule !== value.schedule) throw new Error("该提交已保存为另一版内容，请打开原任务继续编辑");
        return;
      }
      const previous = value.task_id
        ? await readTask({ storage, taskId: task_id })
        : undefined;
      if (runtime.definitions.is_running(task_id))
        throw new Error("任务执行期间请先等待执行结束再编辑定义");
      const preparation = previous?.preparing;
      validate_task_schedule(normalized_when.value, previous && (!preparation || preparation.status === "ready") ? previous.when : undefined);
      if (value.expected_revision !== undefined && preparation?.revision !== value.expected_revision)
        throw new Error("任务已更新，请重新打开最新内容后修改");
      const workflow = normalize_task_state({
        ...previous?.workflow,
        organized: value.organized,
        planned_at,
        planned_end_at,
        due_at,
        timezone: value.timezone,
        require_acceptance: value.require_acceptance,
      });
      // 改规则等于重新安排：终态工作回到待处理，否则新规则永远不会发生。
      if (previous && normalized_when.value !== previous.when && ["completed", "cancelled"].includes(workflow.progress)) {
        workflow.progress = "pending";
        delete workflow.completed_at;
      }
      if (
        !previous &&
        normalized_when.value !== "@manual" &&
        !normalized_when.value.startsWith("time:")
      )
        workflow.progress = "in_progress";
      await writeTask({
        storage,
        taskId: task_id,
        overwrite: Boolean(previous),
        task: {
          ...(previous ?? { taskId: task_id, source: undefined, submission_id: undefined, source_agent_id: undefined }),
          title: value.title,
          kind: value.kind,
          agent_id: value.kind === "user" ? "" : value.agent_id,
          workspace_id: value.kind === "user" ? "" : value.workspace_id,
          ...(previous?.source_agent_id && value.kind !== "user" && value.agent_id !== previous.agent_id
            ? { source_agent_id: value.agent_id }
            : {}),
          when: normalized_when.value,
          schedule: value.schedule,
          body: value.body,
          workflow,
          ...(preparation ? { preparing: {
            ...preparation,
            revision: preparation.revision + 1,
            status: "ready" as const,
            analyzed_body: value.body,
            start_now: value.kind === "agent" && normalized_when.value === "@manual" && (value.start_now ?? preparation.start_now ?? false),
            questions: [], error: undefined, schedule_error: undefined, processing_id: undefined,
          } } : {}),
          taskPath: previous?.taskPath ?? "",
        },
      });
    });
    return { task_id, scheduler: await runtime.reconcile(task_id) };
  });
  action("workspace.command", async (input) => {
    const value = command_schema.parse(input);
    await runtime.definitions.mutate(async (storage) => {
      const task = await readTask({ storage, taskId: value.task_id });
      const state = normalize_task_state(task.workflow);
      const running = runtime.definitions.is_running(value.task_id);
      if (
        running &&
        !["organize", "pause", "resolve", "accept", "revise", "skip"].includes(
          value.command,
        )
      )
        throw new Error("任务仍在执行，请等待执行结束后处理");
      const item = value.item_id
        ? state.inbox.find((entry) => entry.item_id === value.item_id)
        : undefined;
      const occurrence = state.occurrences.find(
        (entry) =>
          entry.occurrence_id === (value.occurrence_id || item?.occurrence_id),
      );
      if (value.item_id && (!item || item.resolved))
        throw new Error("事项不存在或已处理，请刷新");
      if (
        occurrence?.execution_id &&
        occurrence.execution_id === state.active_execution_id &&
        running
      )
        throw new Error("本次事项正在执行，请等待结束");
      switch (value.command) {
        case "organize":
          state.organized = true;
          break;
        case "start":
          state.progress = "in_progress";
          state.organized = true;
          break;
        case "complete":
        case "accept": {
          if (task_is_recurring(task) && !item) throw new Error("请处理具体结果，或暂停定时安排");
          if (value.command === "accept" && item?.kind !== "review")
            throw new Error("请选择待验收结果");
          if (
            task.kind !== "user" &&
            value.command === "complete" &&
            !task_is_recurring(task)
          )
            throw new Error("Agent 工作请通过结果验收完成");
          const now = new Date().toISOString();
          if (occurrence) {
            occurrence.status = "completed";
            occurrence.completed_at = now;
          }
          if (!task_is_recurring(task)) {
            state.progress = "completed";
            state.completed_at = now;
            task.schedule = "paused";
          } else if (!occurrence) {
            state.progress = "completed";
            state.completed_at = now;
            task.schedule = "paused";
          }
          if (item) item.resolved = true;
          if (!task_is_recurring(task) || !occurrence) {
            state.inbox.forEach((entry) => {
              entry.resolved = true;
            });
            state.occurrences
              .filter(
                (entry) =>
                  !["completed", "skipped", "cancelled"].includes(entry.status),
              )
              .forEach((entry) => {
                entry.status = "cancelled";
              });
          }
          break;
        }
        case "revise":
          if (running) throw new Error("任务仍在执行，请等待执行结束后修改结果");
          if (item?.kind !== "review") throw new Error("请选择待验收结果");
          if (value.feedback) item.feedback = value.feedback;
          item.resolved = true;
          if (occurrence) occurrence.status = "pending";
          if (!task_is_recurring(task)) state.progress = "in_progress";
          break;
        case "cancel":
          state.progress = "cancelled";
          task.schedule = "paused";
          state.inbox.forEach((entry) => {
            entry.resolved = true;
          });
          state.occurrences
            .filter(
              (entry) =>
                !["completed", "skipped", "cancelled"].includes(entry.status),
            )
            .forEach((entry) => {
              entry.status = "cancelled";
            });
          break;
        case "reopen":
          state.progress = task_is_recurring(task)
            ? "in_progress"
            : "pending";
          delete state.completed_at;
          break;
        case "pause":
          task.schedule = "paused";
          break;
        case "resume":
          if (task.when === "@manual") throw new Error("请设置未来的一次执行时间，或使用开始执行");
          if (task.when.startsWith("time:") && Date.parse(task.when.slice(5)) <= Date.now()) throw new Error("单次安排已过期或已触发，请重新设置未来时间");
          if (task.preparing && task.preparing.status !== "ready") throw new Error("请先完成任务生成");
          if (["completed", "cancelled"].includes(state.progress))
            throw new Error("请先重新打开任务");
          task.schedule = "enabled";
          break;
        case "resolve":
          if (!item || !["failure", "missed"].includes(item.kind))
            throw new Error("此事项需要完成或验收，不能仅标记处理");
          item.resolved = true;
          break;
        case "skip": {
          if (!task_is_recurring(task))
            throw new Error("仅周期任务支持跳过本次");
          if (occurrence) {
            occurrence.status = "skipped";
            state.inbox
              .filter(
                (entry) => entry.occurrence_id === occurrence.occurrence_id,
              )
              .forEach((entry) => {
                entry.resolved = true;
              });
          } else {
            const planned_at = normalize_task_instant(value.planned_at);
            if (!planned_at || Date.parse(planned_at) <= Date.now())
              throw new Error("请选择未来的周期安排");
            const occurrence_id = task_occurrence_key(
              task,
              new Date(planned_at),
            );
            if (
              state.occurrences.some(
                (entry) => entry.occurrence_id === occurrence_id,
              )
            )
              throw new Error("本次安排已经登记，请刷新");
            state.occurrences.push({
              occurrence_id,
              planned_at,
              status: "skipped",
            });
          }
          break;
        }
      }
      task.workflow = state;
      await save_task_workflow(runtime.definitions, task);
    });
    return {
      task_id: value.task_id,
      scheduler: await runtime.reconcile(value.task_id),
    };
  });
  action("workspace.run", async (input) => {
    const { task_id, occurrence_id } = identity_schema
      .extend({ occurrence_id: z.string().optional() })
      .parse(input);
    const task = await readTask({ storage: runtime.storage, taskId: task_id });
    if (task.preparing && task.preparing.status !== "ready") throw new Error("任务尚未准备完成，请先补充或编辑任务");
    if (task.kind === "user")
      throw new Error("个人待办无需 Agent 执行");
    return await context.system.invoke_agent_power({
      agent_id: task.agent_id,
      workspace_id: task.workspace_id,
      power_id: "task",
      action_id: "run",
      input: { title: task_id, ...(occurrence_id ? { occurrence_id } : {}) },
    });
  });
  action("workspace.history", async (input) => {
    const request = identity_schema.extend({
      cursor: z.string().regex(/^\d{8}-\d{6}-\d{3}$/u).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }).parse(input);
    await readTask({ storage: runtime.storage, taskId: request.task_id });
    return list_task_runs_page({ storage: runtime.storage, ...request });
  });
  action("workspace.run_detail", async (input) => {
    const { task_id, timestamp } = identity_schema
      .extend({ timestamp: z.string().min(1) })
      .parse(input);
    return {
      run: await read_task_run_detail({
        storage: runtime.storage,
        task_id,
        timestamp,
      }),
    };
  });
  action("workspace.delete", async (input) => {
    const { task_id } = identity_schema.parse(input);
    await runtime.definitions.mutate(async (storage) => {
      if (runtime.definitions.is_running(task_id))
        throw new Error("运行中的任务不能删除");
      await deleteTask({ storage, taskId: task_id });
    });
    const scheduler = await runtime.reconcile(task_id);
    await context.notifications
      .dismiss({ topic_key: `task:${task_id}` })
      .catch((error) =>
        context.logger.warn("[TASK] Notification cleanup failed", {
          error: String(error),
        }),
      );
    return { task_id, scheduler };
  });
  return actions;
}

/** 从统一存储生成三个入口的快照，单项状态损坏保持可观察。 */
async function workspace_snapshot(
  context: PowerLifecycleContext,
  runtime: TaskPowerHostRuntime,
): Promise<TaskWorkspaceSnapshot> {
  const [inspection, agents, workspaces] = await Promise.all([
    inspect_task_definitions(runtime.storage),
    context.system.list_agents(),
    context.system.list_workspaces(),
  ]);
  const tasks: TaskWorkspaceSnapshot["tasks"] = [];
  for (const entry of inspection.tasks) {
    // 扫描结果已包含完整定义；仅剥离列表附加字段，保持快照定义的原有结构，避免再次读盘解析。
    const { last_run_at: _last_run_at, ...definition } = entry;
    tasks.push({
      definition,
      running: runtime.definitions.is_running(entry.taskId),
    });
  }
  return {
    tasks: tasks.sort((left, right) => left.definition.workflow.created_at.localeCompare(right.definition.workflow.created_at)),
    agents: agents.map(({ agent_id, name }) => ({ agent_id, name })),
    workspaces: workspaces.map(({ workspace_id, name }) => ({
      workspace_id,
      name,
    })),
    issues: inspection.issues,
  };
}
