/**
 * better-sqlite3 同连接操作协调器。
 * 普通操作、跨 Promise 事务与最终关闭共用一个串行边界；关闭后拒绝新操作，
 * 已接受的操作和事务先结束，随后才释放原生连接。
 */
import { DatabaseClosedError } from "@downcity/federation";

/** 串行执行普通操作和跨 Promise 检查点的显式事务。 */
export class SQLiteCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private closing = false;
  private close_promise?: Promise<void>;

  /** 等待前序操作后独占执行当前操作。 */
  async run<TResult>(handler: () => Promise<TResult>): Promise<TResult> {
    if (this.closing) throw new DatabaseClosedError();
    const previous = this.tail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tail = previous.then(() => current);
    await previous;
    try {
      return await handler();
    } finally {
      release();
    }
  }

  /** 停止接收新操作，等待已排队工作完成后，幂等释放当前连接。 */
  close(handler: () => void): Promise<void> {
    if (!this.close_promise) {
      this.closing = true;
      this.close_promise = this.tail.then(handler);
    }
    return this.close_promise;
  }
}
