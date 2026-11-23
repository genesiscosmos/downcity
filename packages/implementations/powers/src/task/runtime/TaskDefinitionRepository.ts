/**
 * Task 定义仓储的实例级事务入口。
 *
 * TaskPower 的 Agent action、宿主 action 与 Scheduler 共享同一个实例。所有会改变
 * `task.toml` 或删除 Task 聚合目录的操作都在这里串行提交，避免 read-check-write 彼此覆盖。
 */

import type { PowerStorage } from "@downcity/city/power";
import type { TaskExecutionCoordinator } from "./TaskExecutionCoordinator.js";
import { readTask, writeTask } from "./Store.js";
import { require_task_model, task_model_target, validate_task_model } from "./TaskModelBinding.js";
import type { TaskDefinitionV1 } from "../types/Task.js";
import type { TaskModelBinding, TaskModelHost } from "../types/TaskModelBinding.js";

/** TaskPower 唯一的定义事务协调器。 */
export class TaskDefinitionRepository {
  /** 已提交定义事务的串行完成链。 */
  private mutation_chain: Promise<void> = Promise.resolve();

  constructor(
    /** TaskPower 生命周期级统一存储。 */
    readonly storage: PowerStorage,
    /** TaskPower 实例级运行状态事实源。 */
    private readonly executions: TaskExecutionCoordinator,
    /** 完成定义事务后使宿主视图失效，覆盖后台准备与调度器的提交。 */
    private readonly invalidate: () => void = () => {},
    /** 可信宿主注入的模型读取与绑定能力。 */
    readonly model_host?: TaskModelHost,
  ) {}

  /** 只供显式创建或模型确认调用；读取不到来源时保留未配置，不猜测当前 Town。 */
  async capture_model(task: Pick<TaskDefinitionV1, "agent_id" | "workspace_id" | "delivery_session">): Promise<Partial<TaskModelBinding>> {
    if (!this.model_host) return {};
    const binding = await this.model_host.read(task_model_target(task));
    return binding ? require_task_model(binding) : {};
  }

  /** 受理前核对定义中的模型来源，绝不更新该基线。 */
  async validate_model(task: TaskDefinitionV1): Promise<void> {
    await validate_task_model(task, this.model_host);
  }

  /**
   * 串行执行一次完整的 Task 定义事务。
   *
   * 回调必须包含本次变更所需的读取、校验与写入，不能把中间快照带出事务后再提交。
   */
  async mutate<TResult>(
    operation: (storage: PowerStorage) => Promise<TResult>,
  ): Promise<TResult> {
    const current = this.mutation_chain.then(
      async () => await operation(this.storage),
      async () => await operation(this.storage),
    );
    this.mutation_chain = current.then(() => undefined, () => undefined);
    const result = await current;
    this.invalidate();
    return result;
  }

  /** 判断指定 Task 是否正在运行；删除事务用它保护聚合目录。 */
  is_running(task_id: string): boolean {
    return this.executions.is_running(task_id);
  }

  /**
   * 条件完成一次 one-shot 定义。
   *
   * 只在最新定义仍保持本次触发的 `when` 且仍为 enabled 时提交；其他字段全部基于
   * 最新快照保留，避免 Scheduler 使用触发前快照覆盖用户并发修改。
   */
  async complete_one_shot(params: {
    /** 目标 Task 的稳定 ID。 */
    readonly task_id: string;
    /** 本次 Scheduler 实际触发的 one-shot 表达式。 */
    readonly expected_when: string;
  }): Promise<boolean> {
    return await this.mutate(async (storage) => {
      const current = await readTask({
        taskId: params.task_id,
        storage,
      });
      if (
        current.schedule !== "enabled"
        || current.when !== params.expected_when
      ) {
        return false;
      }
      await writeTask({
        taskId: current.taskId,
        storage,
        overwrite: true,
        task: { ...current, when: "@manual", schedule: "paused" },
      });
      return true;
    });
  }
}
