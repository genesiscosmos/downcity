/**
 * TaskPlugin：City 级 Task 定义、执行与 schedule 的唯一所有者。
 *
 * 一个 City 中只有一个 TaskPlugin 实例、一份统一 Task Store 和一个 scheduler。
 * Agent 与 Workspace 只作为 Task 定义中的执行目标，在触发瞬间进入对应动态上下文。
 */

import { Plugin, create_action } from "@downcity/city/plugin";
import type {
  PluginActions,
  PluginContext,
  PluginLifecycleContext,
  PluginStorage,
} from "@downcity/city/plugin";
import type { TaskPluginOptions } from "@/task/types/TaskPluginOptions.js";
import type { TaskSchedulerReloadResult } from "@/task/types/TaskPluginTypes.js";
import { createTaskPluginActions } from "@/task/runtime/TaskPluginActions.js";
import {
  reloadTaskSchedulerAfterMutation,
} from "@/task/runtime/TaskActionExecution.js";
import { TASK_PLUGIN_PROMPT } from "@/task/runtime/TaskPluginSystem.js";
import { TaskExecutionCoordinator } from "@/task/runtime/TaskExecutionCoordinator.js";
import { TaskDefinitionRepository } from "@/task/runtime/TaskDefinitionRepository.js";
import { TaskSchedulerCoordinator, resolve_task_timezone } from "@/task/Scheduler.js";
import { register_task_plugin_host_actions } from "@/task/host/TaskPluginHostActions.js";

/** task plugin 类实现。 */
export class TaskPlugin extends Plugin {
  /** 当前 Plugin 稳定 ID。 */
  readonly name = "task";

  /** Plugin 用户可见标题。 */
  readonly title = "Task";

  /** Plugin 用户可见说明。 */
  readonly description = "Manages reusable tasks and their trigger runtime.";

  /** Task system 文本不承担 scheduler 启动副作用。 */
  readonly system = async (_context: PluginContext): Promise<string> => TASK_PLUGIN_PROMPT;

  /** Task Agent actions。 */
  readonly actions: PluginActions;

  /** 当前实例持有的显式配置。 */
  readonly options: TaskPluginOptions;

  /** 手动触发与 scheduler 共享的实例级执行协调器。 */
  private readonly executions = new TaskExecutionCoordinator();

  /** initialize 后由 Agent action、宿主 action 与 Scheduler 共享的定义事务入口。 */
  private definitions?: TaskDefinitionRepository;

  /** Plugin initialize 后唯一的稳定生命周期上下文。 */
  private lifecycle_context?: PluginLifecycleContext;

  /** Plugin initialize 后唯一的 scheduler。 */
  private scheduler?: TaskSchedulerCoordinator;

  constructor(options?: TaskPluginOptions) {
    super();
    this.options = options || {};
    this.actions = {
      ...createTaskPluginActions({
        resolve_notifications: () => this.require_lifecycle_context().notifications,
        resolve_storage: () => this.require_storage(),
        resolve_definitions: () => this.require_definitions(),
        executions: this.executions,
        resolve_delivery: () => ({
          deliver: async ({ delivery_session, text }) => {
            await this.require_lifecycle_context().system.append_agent_session_assistant_message({
              ...delivery_session,
              text,
            });
          },
        }),
        reloadSchedulerAfterMutation: async (params) =>
          await this.reload_scheduler_after_mutation(params),
      }),
      reload: create_action({
        description: "Reload the task scheduler from persisted tasks.",
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
  async initialize(context: PluginLifecycleContext): Promise<void> {
    this.lifecycle_context = context;
    const definitions = new TaskDefinitionRepository(context.storage, this.executions);
    this.definitions = definitions;
    const scheduler = new TaskSchedulerCoordinator(
      context,
      resolve_task_timezone(this.options.timezone),
      definitions,
    );
    this.scheduler = scheduler;
    register_task_plugin_host_actions(context, {
      storage: context.storage,
      definitions,
      reconcile: async (task_id) => await this.reconcile(task_id),
    });
    await scheduler.initialize();
  }

  /** 停止新增定时触发，并等待已经受理的 Task 执行收口。 */
  async dispose(): Promise<void> {
    const scheduler = this.scheduler;
    this.scheduler = undefined;
    if (scheduler) await scheduler.dispose();
    await this.executions.settle();
    this.definitions = undefined;
    this.lifecycle_context = undefined;
  }

  /** 在定义 mutation 后增量更新一个 Task 的 schedule。 */
  private async reconcile(task_id: string): Promise<TaskSchedulerReloadResult> {
    try {
      const result = await this.require_scheduler().reconcile(task_id);
      return {
        reloaded: true,
        tasks_found: result.tasks_found,
        jobs_scheduled: result.jobs_scheduled,
      };
    } catch (error) {
      const reason = String(error);
      this.lifecycle_context?.logger.warn("[TASK] Task scheduler reconcile failed", {
        task_id,
        error: reason,
      });
      return { reloaded: false, error: reason };
    }
  }

  /** 把 Agent action mutation 映射到实例级 scheduler。 */
  private async reload_scheduler_after_mutation(params: {
    /** 当前动态 Agent/Workspace 调用上下文。 */
    readonly context: PluginContext;
    /** 已提交的 mutation 类型。 */
    readonly action: "create" | "update" | "delete" | "status";
    /** 当前 Task 用户可见标题。 */
    readonly title: string;
    /** 当前 Task 稳定 ID。 */
    readonly task_id: string;
  }): Promise<TaskSchedulerReloadResult> {
    return await reloadTaskSchedulerAfterMutation({
      ...params,
      reloadScheduler: async (task_id) => await this.require_scheduler().reconcile(task_id),
    });
  }

  /** 返回 initialize 后可用的 TaskPlugin 生命周期存储。 */
  private require_storage(): PluginStorage {
    return this.require_lifecycle_context().storage;
  }

  /** 返回 initialize 后可用的唯一 Task 定义事务入口。 */
  private require_definitions(): TaskDefinitionRepository {
    const definitions = this.definitions;
    if (!definitions) throw new Error("TaskPlugin definitions are not initialized");
    return definitions;
  }

  /** 返回 initialize 后可用的稳定生命周期上下文。 */
  private require_lifecycle_context(): PluginLifecycleContext {
    const context = this.lifecycle_context;
    if (!context) throw new Error("TaskPlugin is not initialized");
    return context;
  }

  /** 返回 initialize 后可用的唯一 scheduler。 */
  private require_scheduler(): TaskSchedulerCoordinator {
    const scheduler = this.scheduler;
    if (!scheduler) throw new Error("TaskPlugin scheduler is not initialized");
    return scheduler;
  }
}
