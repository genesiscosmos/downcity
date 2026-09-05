/**
 * Task 执行协调器。
 *
 * 一个 TaskPlugin 实例只允许同一 task_id 同时存在一次执行。手动触发与 scheduler
 * 共享这一个运行中事实源；Plugin dispose 时会等待已经受理的后台执行收口。
 */

/** TaskPlugin 实例级执行协调器。 */
export class TaskExecutionCoordinator {
  /** 当前正在执行的 Task，值为不会向外抛出异常的收口 Promise。 */
  private readonly executions_by_task_id = new Map<string, Promise<void>>();

  /**
   * 尝试受理一次 Task 执行。
   *
   * 返回 false 表示同一 Task 已在执行；operation 的业务失败由调用方在闭包内记录。
   */
  start(task_id_input: string, operation: () => Promise<void>): boolean {
    const task_id = String(task_id_input || "").trim();
    if (!task_id) throw new Error("task_id is required");
    if (this.executions_by_task_id.has(task_id)) return false;

    const execution = operation()
      .catch(() => undefined)
      .finally(() => {
        if (this.executions_by_task_id.get(task_id) === execution) {
          this.executions_by_task_id.delete(task_id);
        }
      });
    this.executions_by_task_id.set(task_id, execution);
    return true;
  }

  /** 判断指定 Task 当前是否正在执行。 */
  is_running(task_id_input: string): boolean {
    return this.executions_by_task_id.has(String(task_id_input || "").trim());
  }

  /** 等待当前已经受理的全部执行结束。 */
  async settle(): Promise<void> {
    await Promise.allSettled([...this.executions_by_task_id.values()]);
  }
}
