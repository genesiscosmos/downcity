/**
 * TaskPower：City 级 Task 定义、执行与 schedule 的唯一所有者。
 *
 * 一个 City 中只有一个 TaskPower 实例、一份统一 Task Store 和一个 scheduler。
 * Agent 与 Workspace 只作为 Task 定义中的执行目标，在触发瞬间进入对应动态上下文。
 */

import { randomUUID } from "node:crypto";
import { capture_task } from "./application/TaskIntakeService.js";
import { recover_task_executions } from "./application/TaskExecutionRecovery.js";
import { TaskPreparationCoordinator } from "./application/TaskPreparationCoordinator.js";
import { Power, create_action } from "@downcity/city/power";
import { z } from "zod";
import type { PowerJsonValue } from "@downcity/city/power";
import type { TaskWorkspaceSnapshot } from "@/task/types/TaskWorkflow.js";
import { readTask } from "@/task/runtime/Store.js";
import type {
  PowerActions,
  PowerContext,
  PowerLifecycleContext,
  PowerStorage,
} from "@downcity/city/power";
import type { TaskPowerOptions } from "@/task/types/TaskPowerOptions.js";
import type { TaskSchedulerReloadResult } from "@/task/types/TaskPowerTypes.js";
import { createTaskPowerActions } from "@/task/runtime/TaskPowerActions.js";
import { reloadTaskSchedulerAfterMutation } from "@/task/runtime/TaskActionExecution.js";
import { TASK_POWER_PROMPT } from "@/task/runtime/TaskPowerSystem.js";
import { TaskExecutionCoordinator } from "@/task/runtime/TaskExecutionCoordinator.js";
import { TaskDefinitionRepository } from "@/task/runtime/TaskDefinitionRepository.js";
import {
  TaskSchedulerCoordinator,
  resolve_task_timezone,
} from "@/task/Scheduler.js";
import { register_task_power_host_actions } from "@/task/host/TaskPowerHostActions.js";
import { register_task_workspace_actions } from "@/task/host/TaskWorkspaceActions.js";

/** task power 类实现。 */
export class TaskPower extends Power {
  /** 当前 Power 稳定 ID。 */
  readonly name = "task";

  /** Power 用户可见标题。 */
  readonly title = "Task";

  /** Power 用户可见说明。 */
  readonly description = "Manages reusable tasks and their trigger runtime.";

  /** Task system 文本不承担 scheduler 启动副作用。 */
  readonly system = async (_context: PowerContext): Promise<string> =>
    TASK_POWER_PROMPT;

  /** Task Agent actions。 */
  readonly actions: PowerActions;

  /** 当前实例持有的显式配置。 */
  readonly options: TaskPowerOptions;

  /** 手动触发与 scheduler 共享的实例级执行协调器。 */
  private readonly executions = new TaskExecutionCoordinator();

  /** initialize 后由 Agent action、宿主 action 与 Scheduler 共享的定义事务入口。 */
  private definitions?: TaskDefinitionRepository;

  /** Power initialize 后唯一的稳定生命周期上下文。 */
  private lifecycle_context?: PowerLifecycleContext;

  /** Power initialize 后唯一的 scheduler。 */
  private scheduler?: TaskSchedulerCoordinator;

  /** 生命周期级后台准备协调器，不启动实际执行。 */
  private preparation?: TaskPreparationCoordinator;

  /** 宿主和 Agent 共用的统一工作动作，不维护第二份工作状态。 */
  private workspace_actions?: ReadonlyMap<
    string,
    (input: PowerJsonValue | undefined) => Promise<PowerJsonValue>
  >;

  constructor(options?: TaskPowerOptions) {
    super();
    this.options = options || {};
    this.actions = {
      ...createTaskPowerActions({
        resolve_notifications: () =>
          this.require_lifecycle_context().notifications,
        resolve_storage: () => this.require_storage(),
        resolve_definitions: () => this.require_definitions(),
        executions: this.executions,
        resolve_delivery: () => ({
          deliver: async ({ delivery_session, text }) => {
            await this.require_lifecycle_context().system.append_agent_session_message(
              {
                ...delivery_session,
                workspace_id: delivery_session.workspace_id ?? undefined,
                text,
              },
            );
          },
        }),
        reloadSchedulerAfterMutation: async (params) =>
          await this.reload_scheduler_after_mutation(params),
      }),
      capture: create_action({
        description: "Save the user's task text immediately and prepare it in the background. Preserve the user's wording; do not invent delegation or execution authorization. Reuse submission_id when retrying the same submission.",
        returns: "task_id, submission_id; saved does not mean execution has started",
        access: "write",
        input_schema: {
          zod: z.object({ text: z.string().trim().min(1).max(24000), submission_id: z.uuid().optional(), timezone: z.string().optional() }),
          json_schema: {
            type: "object", required: ["text"], properties: {
              text: { type: "string", description: "The user's original task request, without invented execution instructions." },
              submission_id: { type: "string", description: "UUID from a previous capture response when retrying that submission." },
              timezone: { type: "string", description: "User's IANA timezone when known; otherwise the task runtime timezone is used." },
            },
          },
        },
        execute: async ({ context, input }) => {
          const value = input as { /** User's original request. */ text: string; /** Optional retry identity. */ submission_id?: string; /** Optional user timezone. */ timezone?: string };
          const submission_id = value.submission_id || randomUUID();
          const delivery_session = context.session ? {
            agent_id: context.agent.id, workspace_id: context.workspace?.id ?? null,
            session_id: context.session.id, origin_type: context.session.origin.type,
          } : undefined;
          const result = await capture_task(this.require_definitions(), {
            text: value.text, submission_id,
            timezone: value.timezone || resolve_task_timezone(this.options.timezone),
          }, delivery_session);
          this.preparation?.enqueue(result.task_id);
          return { success: true, data: { ...result, submission_id }, message: "Task saved; preparation continues in the background." };
        },
      }),
      prepare: create_action({
        description: "Add the user's clarification to an existing task or retry failed preparation. Preserve the user's wording. This pauses previous automatic arrangements until the new version is ready.",
        returns: "task_id, scheduler",
        access: "write",
        input_schema: {
          zod: z.object({ task_id: z.string().min(1), text: z.string().trim().min(1).max(24000).optional() }),
          json_schema: { type: "object", required: ["task_id"], properties: {
            task_id: { type: "string", description: "Stable task identity from capture or inbox." },
            text: { type: "string", description: "User clarification; omit to retry preparation." },
          } },
        },
        execute: async ({ context, input }) => {
          const task_id = String((input as Record<string, PowerJsonValue>).task_id);
          const task = await readTask({ storage: this.require_storage(), taskId: task_id });
          if (task.frontmatter.kind !== "self" && task.frontmatter.agent_id !== context.agent.id) throw new Error("Task belongs to another Agent");
          return { success: true, data: await this.invoke_workspace_action("workspace.prepare", input) };
        },
      }),
      work: create_action({
        description:
          "Organize, start, complete, reopen, or handle an inbox item for a task. Use task_id from list; accepting a result requires the matching item_id.",
        returns: "task_id, scheduler",
        access: "write",
        input_schema: {
          zod: z.object({
            task_id: z.string(),
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
          }),
          json_schema: {
            type: "object",
            required: ["task_id", "command"],
            properties: {
              task_id: {
                type: "string",
                description: "Stable task ID from list or inbox.",
              },
              command: {
                type: "string",
                enum: [
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
                ],
              },
              item_id: {
                type: "string",
                description: "Matching inbox request ID.",
              },
              occurrence_id: {
                type: "string",
                description: "Specific recurring occurrence.",
              },
            },
          },
        },
        execute: async ({ context, input }) => {
          const task_id = String(
            (input as Record<string, PowerJsonValue>).task_id,
          );
          const task = await readTask({
            storage: this.require_storage(),
            taskId: task_id,
          });
          if (
            task.frontmatter.kind !== "self" &&
            task.frontmatter.agent_id !== context.agent.id
          )
            throw new Error("Task belongs to another Agent");
          return {
            success: true,
            data: await this.invoke_workspace_action(
              "workspace.command",
              input,
            ),
          };
        },
      }),
      inbox: create_action({
        description:
          "List unorganized tasks and unresolved task items. Reading does not complete or accept work.",
        returns:
          "tasks(task_id, title, organized, preparation(status, questions, error, schedule_error), items(item_id, kind, message, occurrence_id, run_timestamp))",
        access: "read",
        execute: async ({ context }) => {
          const snapshot = (await this.invoke_workspace_action(
            "workspace.snapshot",
          )) as unknown as TaskWorkspaceSnapshot;
          const tasks = snapshot.tasks
            .filter(
              (task) =>
                task.definition.frontmatter.kind === "self" ||
                task.definition.frontmatter.agent_id === context.agent.id,
            )
            .map((task) => ({
              task_id: task.task_id,
              title: task.definition.frontmatter.title,
              organized: task.workflow.organized,
              ...(task.definition.frontmatter.preparation ? { preparation: task.definition.frontmatter.preparation } : {}),
              items: task.state.inbox.filter((item) => !item.resolved),
            }))
            .filter((task) => !task.organized || task.items.length || task.preparation?.status === "needs_input" || task.preparation?.status === "failed" || task.preparation?.schedule_error);
          return {
            success: true,
            data: { tasks } as unknown as PowerJsonValue,
          };
        },
      }),
      reload: create_action({
        description: "Reload the task scheduler from persisted tasks.",
        returns: "reloaded, task_count",
        access: "write",
        execute: async ({ context }) => {
          const result = await this.require_scheduler().reload();
          context.logger.info("[TASK] Task scheduler reloaded", result);
          return {
            success: true,
            message: "task scheduler reloaded",
            data: result,
          };
        },
      }),
    };
  }

  /** 注册宿主管理 actions，并从统一 Store 恢复 schedule。 */
  async initialize(context: PowerLifecycleContext): Promise<void> {
    this.lifecycle_context = context;
    const definitions = new TaskDefinitionRepository(
      context.storage,
      this.executions,
    );
    this.definitions = definitions;
    const scheduler = new TaskSchedulerCoordinator(
      context,
      resolve_task_timezone(this.options.timezone),
      definitions,
    );
    this.scheduler = scheduler;
    register_task_power_host_actions(context, {
      storage: context.storage,
      definitions,
      reconcile: async (task_id) => await this.reconcile(task_id),
    });
    const preparation = new TaskPreparationCoordinator(context, definitions, this.options.analyze_task, async (task_id) => await this.reconcile(task_id));
    this.preparation = preparation;
    this.workspace_actions = register_task_workspace_actions(context, {
      storage: context.storage,
      definitions,
      reconcile: async (task_id) => await this.reconcile(task_id),
    }, (task_id) => preparation.enqueue(task_id));
    await recover_task_executions(definitions);
    await scheduler.initialize();
    await preparation.initialize();
  }

  /** 停止新增定时触发，并等待已经受理的 Task 执行收口。 */
  async dispose(): Promise<void> {
    const scheduler = this.scheduler;
    this.scheduler = undefined;
    const errors: unknown[] = [];
    try { await this.preparation?.dispose(); } catch (error) { errors.push(error); }
    this.preparation = undefined;
    try {
      if (scheduler) await scheduler.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.executions.settle();
    } catch (error) {
      errors.push(error);
    } finally {
      this.workspace_actions = undefined;
      this.definitions = undefined;
      this.lifecycle_context = undefined;
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "TaskPower disposal failed");
    }
  }

  /** 在定义 mutation 后增量更新一个 Task 的 schedule。 */
  private async reconcile(task_id: string): Promise<TaskSchedulerReloadResult> {
    try {
      const result = await this.require_scheduler().reconcile(task_id);
      return {
        reloaded: true,
        tasks_found: result.tasks_found,
        jobs_scheduled: result.jobs_scheduled,
        tasks_invalid: result.tasks_invalid,
      };
    } catch (error) {
      const reason = String(error);
      this.lifecycle_context?.logger.warn(
        "[TASK] Task scheduler reconcile failed",
        {
          task_id,
          error: reason,
        },
      );
      return { reloaded: false, error: reason };
    }
  }

  /** 把 Agent action mutation 映射到实例级 scheduler。 */
  private async reload_scheduler_after_mutation(params: {
    /** 当前动态 Agent/Workspace 调用上下文。 */
    readonly context: PowerContext;
    /** 已提交的 mutation 类型。 */
    readonly action: "create" | "update" | "delete" | "status";
    /** 当前 Task 用户可见标题。 */
    readonly title: string;
    /** 当前 Task 稳定 ID。 */
    readonly task_id: string;
  }): Promise<TaskSchedulerReloadResult> {
    return await reloadTaskSchedulerAfterMutation({
      ...params,
      reloadScheduler: async (task_id) =>
        await this.require_scheduler().reconcile(task_id),
    });
  }

  /** 调用与宿主共用的工作动作，生命周期结束后不可继续使用。 */
  private async invoke_workspace_action(
    id: string,
    input?: PowerJsonValue,
  ): Promise<PowerJsonValue> {
    const action = this.workspace_actions?.get(id);
    if (!action) throw new Error("Task workspace is not initialized");
    return await action(input);
  }

  /** 返回 initialize 后可用的 TaskPower 生命周期存储。 */
  private require_storage(): PowerStorage {
    return this.require_lifecycle_context().storage;
  }

  /** 返回 initialize 后可用的唯一 Task 定义事务入口。 */
  private require_definitions(): TaskDefinitionRepository {
    const definitions = this.definitions;
    if (!definitions)
      throw new Error("TaskPower definitions are not initialized");
    return definitions;
  }

  /** 返回 initialize 后可用的稳定生命周期上下文。 */
  private require_lifecycle_context(): PowerLifecycleContext {
    const context = this.lifecycle_context;
    if (!context) throw new Error("TaskPower is not initialized");
    return context;
  }

  /** 返回 initialize 后可用的唯一 scheduler。 */
  private require_scheduler(): TaskSchedulerCoordinator {
    const scheduler = this.scheduler;
    if (!scheduler) throw new Error("TaskPower scheduler is not initialized");
    return scheduler;
  }
}
