/**
 * Task 定义仓储的实例级事务入口。
 *
 * TaskPower 的 Agent action、宿主 action 与 Scheduler 共享同一个实例。所有会改变
 * `task.md` 或删除 Task 聚合目录的操作都在这里串行提交，避免 read-check-write 彼此覆盖。
 */

import type { PowerStorage } from "@downcity/city/power";
import type { TaskExecutionCoordinator } from "./TaskExecutionCoordinator.js";
import { readTask, writeTask } from "./Store.js";

/** TaskPower 唯一的定义事务协调器。 */
export class TaskDefinitionRepository {
  /** 已提交定义事务的串行完成链。 */
  private mutation_chain: Promise<void> = Promise.resolve();

  constructor(
    /** TaskPower 生命周期级统一存储。 */
    readonly storage: PowerStorage,
    /** TaskPower 实例级运行状态事实源。 */
    private readonly executions: TaskExecutionCoordinator,
  ) {}

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
    return await current;
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
        current.frontmatter.status !== "enabled"
        || current.frontmatter.when !== params.expected_when
      ) {
        return false;
      }
      await writeTask({
        taskId: current.taskId,
        storage,
        overwrite: true,
        frontmatter: {
          ...current.frontmatter,
          when: "@manual",
          status: "paused",
        },
        body: current.body,
      });
      return true;
    });
  }
}
