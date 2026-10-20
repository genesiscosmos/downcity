/** 已持久化的记忆业务变更，不携带正文、文件路径或 Action 执行信息。 */
export type MemoryChange = {
  /** 知识记录写入或删除，证据与投影按各自实际提交分别通知。 */
  readonly kind: "knowledge";
  /** 记录的实际变更方式；删除不存在记录不产生事件。 */
  readonly operation: "written" | "deleted";
  /** Provider 的稳定逻辑标识，可用于重新读取；不是物理路径。 */
  readonly memory_id: string;
} | {
  /** User 或 Agent Profile 正文已经提交。 */
  readonly kind: "profile";
  /** Profile 正文的实际变更方式。 */
  readonly operation: "written" | "deleted";
  /** Profile 归属；User 跨 Agent 共享。 */
  readonly target: "user" | "agent";
  /** Agent 私有 Profile 的稳定身份；User Profile 为 null。 */
  readonly agent_id: string | null;
};

/** 实例化时注入的业务回调；异步处理不阻塞记忆写入，无历史重放。 */
export type MemoryChangeHandler = (event: MemoryChange) => void | Promise<void>;

/** 业务提交后的安全分发，回调失败不改变已完成的持久化结果。 */
export function notify_memory_change(handler: MemoryChangeHandler | undefined, event: MemoryChange, report: () => void): void {
  if (!handler) return;
  try {
    void Promise.resolve(handler(Object.freeze(event))).catch(report);
  } catch {
    report();
  }
}
