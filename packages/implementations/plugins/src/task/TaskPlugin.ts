/**
 * TaskPlugin：task plugin 的类实例实现。
 *
 * 关键点（中文）
 * - task 的长期运行态（cron engine）归属于 TaskPlugin 实例。
 * - task 的 prompt、action input、action execution 都已拆到独立模块。
 * - 当前文件只保留实例骨架与 lifecycle，不再依赖旧的模块级单例。
 */

import { Plugin, create_action } from "@downcity/city/plugin";
import type { PluginActions } from "@downcity/city/plugin";
import type { PluginContext } from "@downcity/city/plugin";
import type {
  TaskCronRegisterResult,
  TaskSchedulerReloadResult,
} from "@/task/types/TaskPluginTypes.js";
import type { TaskPluginOptions } from "@/task/types/TaskPluginOptions.js";
import { TaskCronTriggerEngine } from "@/task/runtime/CronTrigger.js";
import { registerTaskCronJobs } from "@/task/Scheduler.js";
import {
  createTaskPluginActions,
} from "@/task/runtime/TaskPluginActions.js";
import {
  reloadTaskSchedulerAfterMutation,
} from "@/task/runtime/TaskActionExecution.js";
import { TASK_PLUGIN_PROMPT } from "@/task/runtime/TaskPluginSystem.js";
import { resolve_runtime_timezone } from "@downcity/agent";
import type { TaskWorkspaceRuntime } from "@/task/types/TaskWorkspaceRuntime.js";

const TASK_LOG_PREFIX = "[TASK]";

function formatTaskLogMessage(message: string): string {
  return `${TASK_LOG_PREFIX} ${message}`;
}

/**
 * task plugin 类实现。
 */
export class TaskPlugin extends Plugin {
  /**
   * 当前 plugin 名称。
   */
  readonly name = "task";

  /**
   * task plugin 的 system 文本提供器。
   */
  readonly system = async (context: PluginContext): Promise<string> => {
    void context;
    return TASK_PLUGIN_PROMPT;
  };

  /**
   * task plugin 的 action 定义表。
   */
  readonly actions: PluginActions;

  /**
   * 当前实例持有的显式配置。
   */
  public readonly options: TaskPluginOptions;

  /**
   * 当前实例持有的 cron engine。
   *
   * 关键点（中文）
   * - 这是 per-plugin-instance 的长期运行态。
   * - 不再复用 module-global 单例。
   */
  private readonly runtimes_by_workspace = new Map<string, TaskWorkspaceRuntime>();

  /** 各 Workspace 当前唯一的 cron 启动流程。 */
  private readonly starts_by_workspace = new Map<string, Promise<TaskCronRegisterResult | null>>();

  constructor(options?: TaskPluginOptions) {
    super();
    this.options = options || {};

    this.actions = {
      ...createTaskPluginActions({
        notifications: this.options.notifications,
        reloadSchedulerAfterMutation: async (params) =>
          this.reloadSchedulerAfterMutation(params),
      }),
      reload: create_action({
        description: "Reload the task scheduler from persisted tasks.",
        execute: async ({ context }) => {
          const result = await this.restart_cron_runtime(context);
          context.logger.info(
            formatTaskLogMessage(
              `Task cron trigger reloaded (tasks=${result.tasksFound}, jobs=${result.jobsScheduled})`,
            ),
          );
          return {
            success: true,
            message: "task scheduler reloaded",
            data: {
              tasks_found: result.tasksFound,
              jobs_scheduled: result.jobsScheduled,
            },
          };
        },
      }),
    };

    this.lifecycle = {
      start: async () => {},
      connect: async (context) => {
        await this.start_cron_runtime(context);
      },
      disconnect: async (context) => {
        await this.stop_cron_runtime(task_scope_key(context));
      },
      stop: async () => {
        await Promise.allSettled([...this.starts_by_workspace.values()]);
        await Promise.all([...this.runtimes_by_workspace.keys()].map(async (scope_key) => {
          await this.stop_cron_runtime(scope_key);
        }));
        this.starts_by_workspace.clear();
      },
    };
  }

  /**
   * 启动当前实例的 cron runtime。
   */
  async start_cron_runtime(
    context: PluginContext,
  ): Promise<TaskCronRegisterResult | null> {
    const scope_key = task_scope_key(context);
    if (this.runtimes_by_workspace.has(scope_key)) return null;
    const started = this.starts_by_workspace.get(scope_key);
    if (started) return await started;

    const start_promise = (async () => {
      const engine = new TaskCronTriggerEngine();
      const running_task_ids = new Set<string>();
      const register_result = await registerTaskCronJobs({
        context,
        engine,
        notifications: this.options.notifications,
        timezone: this.resolveTimezone(),
        runningTaskIds: running_task_ids,
      });
      await engine.start();
      this.runtimes_by_workspace.set(scope_key, {
        context,
        cron_engine: engine,
        running_task_ids,
      });
      return register_result;
    })();
    this.starts_by_workspace.set(scope_key, start_promise);
    try {
      return await start_promise;
    } finally {
      if (this.starts_by_workspace.get(scope_key) === start_promise) {
        this.starts_by_workspace.delete(scope_key);
      }
    }
  }

  /**
   * 停止当前实例的 cron runtime。
   */
  async stop_cron_runtime(scope_key: string): Promise<boolean> {
    const runtime = this.runtimes_by_workspace.get(scope_key);
    if (!runtime) return false;
    this.runtimes_by_workspace.delete(scope_key);
    await runtime.cron_engine.stop();
    return true;
  }

  /**
   * 重启当前实例的 cron runtime。
   */
  async restart_cron_runtime(
    context: PluginContext,
  ): Promise<TaskCronRegisterResult> {
    await this.stop_cron_runtime(task_scope_key(context));
    const started = await this.start_cron_runtime(context);
    return (
      started || {
        tasksFound: 0,
        jobsScheduled: 0,
      }
    );
  }

  /**
   * 任务定义变更后重载 scheduler。
   */
  private async reloadSchedulerAfterMutation(params: {
    context: PluginContext;
    action: "create" | "update" | "delete" | "status";
    title: string;
  }): Promise<TaskSchedulerReloadResult> {
    return await reloadTaskSchedulerAfterMutation({
      context: params.context,
      action: params.action,
      title: params.title,
      reloadScheduler: async (context) => this.restart_all_cron_runtimes(context),
    });
  }

  /**
   * Task 定义变化后重启所有已激活 Workspace 的调度资源。
   *
   * Task 可以在更新时切换执行 Workspace，因此必须同时移除旧 Workspace 的注册项，
   * 并为新 Workspace 建立注册项。当前 action 的 Workspace 即使此前未激活也会纳入重载。
   */
  private async restart_all_cron_runtimes(
    context: PluginContext,
  ): Promise<TaskCronRegisterResult> {
    const contexts_by_workspace = new Map<string, PluginContext>(
      [...this.runtimes_by_workspace.values()].map((runtime) => [
        runtime.context.workspace.id,
        runtime.context,
      ]),
    );
    contexts_by_workspace.set(context.workspace.id, context);

    const results = await Promise.all(
      [...contexts_by_workspace.values()].map(async (workspace_context) =>
        this.restart_cron_runtime(workspace_context)
      ),
    );
    return results.reduce<TaskCronRegisterResult>(
      (total, result) => ({
        tasksFound: total.tasksFound + result.tasksFound,
        jobsScheduled: total.jobsScheduled + result.jobsScheduled,
      }),
      { tasksFound: 0, jobsScheduled: 0 },
    );
  }

  /**
   * 解析当前 task cron 使用的时区。
   */
  private resolveTimezone(): string {
    return String(this.options.timezone || "").trim() || resolve_runtime_timezone();
  }
}

/** 返回共享 TaskPlugin 内唯一的 Agent/Workspace 作用域键。 */
function task_scope_key(context: PluginContext): string {
  return `${context.agent.id}\u0000${context.workspace.id}`;
}
