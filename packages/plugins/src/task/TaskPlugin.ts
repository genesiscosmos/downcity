/**
 * TaskPlugin：task plugin 的类实例实现。
 *
 * 关键点（中文）
 * - task 的长期运行态（cron engine）归属于 TaskPlugin 实例。
 * - task 的 prompt、action input、action execution 都已拆到独立模块。
 * - 当前文件只保留实例骨架与 lifecycle，不再依赖旧的模块级单例。
 */

import { BasePlugin, create_action } from "@downcity/agent";
import type { PluginActions } from "@downcity/agent";
import type { PluginContext } from "@downcity/agent";
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

const TASK_LOG_PREFIX = "[TASK]";

function formatTaskLogMessage(message: string): string {
  return `${TASK_LOG_PREFIX} ${message}`;
}

/**
 * task plugin 类实现。
 */
export class TaskPlugin extends BasePlugin {
  /**
   * 当前 plugin 名称。
   */
  readonly name = "task";

  /**
   * task plugin 的 system 文本提供器。
   */
  readonly system = (): string => TASK_PLUGIN_PROMPT;

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
  public cronEngine: TaskCronTriggerEngine | null = null;

  /**
   * 当前实例持有的运行中 task 锁。
   *
   * 关键点（中文）
   * - scheduler reload 会替换 cron engine。
   * - 锁必须挂在 plugin 实例上，避免 reload 后同一 task 被新旧调度器并发触发。
   */
  private readonly runningTaskIds = new Set<string>();

  constructor(options?: TaskPluginOptions) {
    super();
    this.options = options || {};

    this.actions = {
      ...createTaskPluginActions({
        reloadSchedulerAfterMutation: async (params) =>
          this.reloadSchedulerAfterMutation(params),
      }),
      reload: create_action({
        description: "Reload the task scheduler from persisted tasks.",
        execute: async ({ context }) => {
          const result = await this.restartCronRuntime(context);
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
      start: async (context) => {
        const result = await this.startCronRuntime(context);
        if (!result) return;
        context.logger.info(
          formatTaskLogMessage(
            `Task cron trigger started (tasks=${result.tasksFound}, jobs=${result.jobsScheduled})`,
          ),
        );
      },
      stop: async (context) => {
        const stopped = await this.stopCronRuntime();
        if (!stopped) return;
        context.logger.info(formatTaskLogMessage("Task cron trigger stopped"));
      },
    };
  }

  /**
   * 启动当前实例的 cron runtime。
   */
  async startCronRuntime(
    context: PluginContext,
  ): Promise<TaskCronRegisterResult | null> {
    if (this.cronEngine) return null;

    const engine = new TaskCronTriggerEngine();
    const registerResult = await registerTaskCronJobs({
      context,
      engine,
      timezone: this.resolveTimezone(),
      runningTaskIds: this.runningTaskIds,
    });
    await engine.start();
    this.cronEngine = engine;
    return registerResult;
  }

  /**
   * 停止当前实例的 cron runtime。
   */
  async stopCronRuntime(): Promise<boolean> {
    if (!this.cronEngine) return false;
    const previous = this.cronEngine;
    this.cronEngine = null;
    await previous.stop();
    return true;
  }

  /**
   * 重启当前实例的 cron runtime。
   */
  async restartCronRuntime(
    context: PluginContext,
  ): Promise<TaskCronRegisterResult> {
    await this.stopCronRuntime();
    const started = await this.startCronRuntime(context);
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
      reloadScheduler: async (context) => this.restartCronRuntime(context),
    });
  }

  /**
   * 解析当前 task cron 使用的时区。
   */
  private resolveTimezone(): string {
    return String(this.options.timezone || "").trim() || resolve_runtime_timezone();
  }
}
