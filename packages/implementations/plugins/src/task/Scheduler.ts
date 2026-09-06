/**
 * TaskPlugin 实例级调度协调器。
 *
 * Scheduler 只持有 City 生命周期上下文、统一 Task Store 与 timer，不保存任何
 * Agent/Workspace PluginContext。真正触发时才按照 Task 定义中的 agent_id 和
 * workspace_id 请求 City 创建执行范围。
 */

import type { PluginLifecycleContext } from "@downcity/city/plugin";
import { resolve_runtime_timezone } from "@downcity/agent";
import {
  isTaskWhenManual,
  resolveTaskWhenCronExpression,
  resolveTaskWhenOneShotMs,
} from "./runtime/Model.js";
import { TaskCronTriggerEngine } from "./runtime/CronTrigger.js";
import { listTasks, readTask } from "./runtime/Store.js";
import type { TaskDefinitionRepository } from "./runtime/TaskDefinitionRepository.js";
import type { ShipTaskDefinitionV1, ShipTaskRunTriggerV1 } from "./types/Task.js";
import type {
  ScheduledTaskActionResult,
  TaskCronRegisterResult,
} from "./types/TaskPluginTypes.js";
import type { TaskCronEngine } from "./types/Cron.js";

const TASK_LOG_PREFIX = "[TASK]";

/** 统一管理一个 TaskPlugin 实例内全部 Task schedule。 */
export class TaskSchedulerCoordinator {
  /** 已经在 engine 中登记过 schedule 的 Task ID。 */
  private readonly scheduled_task_ids = new Set<string>();

  /** scheduler mutation 的串行提交链。 */
  private operation_chain: Promise<void> = Promise.resolve();

  /** 已进入 TaskPlugin 的定时触发回调，dispose 必须等待其收口。 */
  private readonly trigger_executions = new Set<Promise<void>>();

  /** scheduler 是否已经结束生命周期。 */
  private disposed = false;

  constructor(
    /** TaskPlugin 加入 City 后获得的稳定生命周期上下文。 */
    private readonly context: PluginLifecycleContext,
    /** cron 表达式使用的 IANA 时区。 */
    private readonly timezone: string,
    /** TaskPlugin 唯一的定义事务入口。 */
    private readonly definitions: TaskDefinitionRepository,
    /** 当前 Plugin 实例唯一的 timer engine；测试可以注入确定性实现。 */
    private readonly engine: TaskCronEngine = new TaskCronTriggerEngine(),
  ) {}

  /**
   * 从统一 Task Store 恢复全部 schedule，再启动 timer。
   *
   * Agent 与 Workspace 可以晚于 Plugin 注册；这里只登记 timer，触发时再解析执行目标。
   */
  async initialize(): Promise<TaskCronRegisterResult> {
    const result = await this.reload();
    await this.engine.start();
    return result;
  }

  /** 从唯一事实源完整重建 schedule。 */
  async reload(): Promise<TaskCronRegisterResult> {
    let result: TaskCronRegisterResult = { tasks_found: 0, jobs_scheduled: 0 };
    await this.enqueue(async () => {
      this.assert_active();
      for (const task_id of [...this.scheduled_task_ids]) this.unregister(task_id);
      const tasks = await listTasks(this.definitions.storage);
      for (const item of tasks) {
        const task = await readTask({
          taskId: item.taskId,
          storage: this.definitions.storage,
        });
        result.jobs_scheduled += this.register(task);
      }
      result.tasks_found = tasks.length;
    });
    return result;
  }

  /** 在一个 Task mutation 提交后只更新该 Task 的 schedule。 */
  async reconcile(task_id_input: string): Promise<TaskCronRegisterResult> {
    const task_id = String(task_id_input || "").trim();
    if (!task_id) throw new Error("task_id is required");
    let task_found = false;
    let jobs_scheduled = 0;
    await this.enqueue(async () => {
      this.assert_active();
      this.unregister(task_id);
      try {
        const task = await readTask({
          taskId: task_id,
          storage: this.definitions.storage,
        });
        task_found = true;
        jobs_scheduled = this.register(task);
      } catch (error) {
        if (!is_missing_task_error(error)) throw error;
      }
    });
    return { tasks_found: task_found ? 1 : 0, jobs_scheduled };
  }

  /** 停止全部 timer，并等待已经提交的 scheduler mutation 收口。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.engine.stop();
    await this.operation_chain;
    await Promise.allSettled([...this.trigger_executions]);
    this.scheduled_task_ids.clear();
  }

  /** 根据最新 Task 定义登记 cron 或 one-shot schedule。 */
  private register(task: ShipTaskDefinitionV1): number {
    if (task.frontmatter.status !== "enabled") return 0;
    const cron_expression = resolveTaskWhenCronExpression(task.frontmatter.when);
    if (cron_expression && !isTaskWhenManual(task.frontmatter.when)) {
      this.engine.register({
        id: cron_job_id(task.taskId),
        expression: cron_expression,
        timezone: this.timezone,
        execute: async () => await this.trigger(task.taskId, { type: "cron" }),
      });
      this.scheduled_task_ids.add(task.taskId);
      return 1;
    }

    const planned_time_ms = resolveTaskWhenOneShotMs(task.frontmatter.when);
    if (planned_time_ms === null) return 0;
    this.engine.register({
      id: time_job_id(task.taskId),
      expression: "* * * * *",
      timezone: this.timezone,
      execute: async () => {
        if (Date.now() < planned_time_ms) return;
        await this.trigger(task.taskId, { type: "time" });
      },
    });
    this.scheduled_task_ids.add(task.taskId);
    return 1;
  }

  /** 记录一次已进入 scheduler 的触发，并在关闭开始后忽略排队回调。 */
  private async trigger(task_id: string, trigger: ShipTaskRunTriggerV1): Promise<void> {
    if (this.disposed) return;
    const execution = this.execute(task_id, trigger).finally(() => {
      this.trigger_executions.delete(execution);
    });
    this.trigger_executions.add(execution);
    await execution;
  }

  /** 在触发瞬间复查定义，并进入其声明的 Agent/Workspace 执行范围。 */
  private async execute(task_id: string, trigger: ShipTaskRunTriggerV1): Promise<void> {
    try {
      const task = await readTask({ taskId: task_id, storage: this.definitions.storage });
      if (task.frontmatter.status !== "enabled") return;
      if (!trigger_matches(task, trigger)) return;

      const raw_result = await this.context.system.invoke_agent_plugin({
        agent_id: task.frontmatter.agent_id,
        workspace_id: task.frontmatter.workspace_id,
        plugin_id: "task",
        action_id: "run",
        input: {
          title: task.frontmatter.title,
          scheduler_trigger: trigger.type,
        },
      }) as ScheduledTaskActionResult;
      if (!raw_result.success) {
        throw new Error(raw_result.error || `Task action failed: ${task.frontmatter.title}`);
      }
      if (!raw_result.data?.accepted) {
        this.context.logger.warn(`${TASK_LOG_PREFIX} Task trigger skipped because it is already running`, {
          task_id,
          trigger: trigger.type,
        });
        return;
      }

      // 一次性任务只在执行真正被受理后停用；目标资源缺失时保留 enabled 以便后续重试。
      if (trigger.type === "time") {
        const committed = await this.definitions.complete_one_shot({
          task_id: task.taskId,
          expected_when: task.frontmatter.when,
        });
        if (committed && !this.disposed) await this.reconcile(task.taskId);
      }
    } catch (error) {
      this.context.logger.error(`${TASK_LOG_PREFIX} Scheduled task trigger failed`, {
        task_id,
        trigger: trigger.type,
        error: String(error),
      });
    }
  }

  /** 从 engine 删除一个 Task 可能拥有的全部 job。 */
  private unregister(task_id: string): void {
    this.engine.unregister(cron_job_id(task_id));
    this.engine.unregister(time_job_id(task_id));
    this.scheduled_task_ids.delete(task_id);
  }

  /** 串行提交一次 scheduler 配置变更。 */
  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const current = this.operation_chain.then(operation, operation);
    this.operation_chain = current.catch(() => undefined);
    await current;
  }

  /** scheduler dispose 后禁止新的配置变更。 */
  private assert_active(): void {
    if (this.disposed) throw new Error("Task scheduler is disposed");
  }
}

/** 解析 TaskPlugin 使用的最终 cron 时区。 */
export function resolve_task_timezone(timezone?: string): string {
  return String(timezone || "").trim() || resolve_runtime_timezone();
}

/** 判断触发类型仍与磁盘中的最新定义一致。 */
function trigger_matches(task: ShipTaskDefinitionV1, trigger: ShipTaskRunTriggerV1): boolean {
  if (trigger.type === "cron") return resolveTaskWhenCronExpression(task.frontmatter.when) !== null;
  if (trigger.type === "time") {
    const planned_time_ms = resolveTaskWhenOneShotMs(task.frontmatter.when);
    return planned_time_ms !== null && Date.now() >= planned_time_ms;
  }
  return false;
}

/** Task 不存在时 reconcile 只需要保持未注册状态。 */
function is_missing_task_error(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("ENOENT") || message.includes("Task not found");
}

/** 创建 cron job 稳定 ID。 */
function cron_job_id(task_id: string): string {
  return `task:${task_id}`;
}

/** 创建 one-shot job 稳定 ID。 */
function time_job_id(task_id: string): string {
  return `task-time:${task_id}`;
}
