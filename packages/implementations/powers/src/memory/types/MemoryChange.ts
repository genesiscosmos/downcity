/** 已持久化的记忆业务变更，不携带正文、文件路径或 Action 执行信息。 */
export type MemoryChange = {
  /** 统一记录已提交。 */
  readonly kind: "record";
  /** 实际提交动作。 */
  readonly operation: "written" | "deleted";
  /** 可供重新读取的逻辑身份。 */
  readonly memory_id: string;
};

/** 实例化时注入的业务回调；异步处理不阻塞记忆写入，无历史重放。 */
export type MemoryChangeHandler = (event: MemoryChange) => void | Promise<void>;

/** 业务提交后的安全分发，回调失败不改变已完成的持久化结果。 */
export function notify_memory_change(handler: MemoryChangeHandler | undefined, event: MemoryChange, report: () => void = () => undefined): void {
  if (!handler) return;
  try {
    void Promise.resolve(handler(Object.freeze(event))).catch(report);
  } catch {
    report();
  }
}
