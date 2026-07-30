/** better-sqlite3 同连接操作协调器。 */

/** 串行执行普通操作和跨 Promise 检查点的显式事务。 */
export class SQLiteCoordinator {
  private tail: Promise<void> = Promise.resolve();

  /** 等待前序操作后独占执行当前操作。 */
  async run<TResult>(handler: () => Promise<TResult>): Promise<TResult> {
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
}
