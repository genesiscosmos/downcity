/**
 * Agent Session 集合的进程内生命周期互斥。
 *
 * 创建、恢复和删除可以并发；归档扫描与它们互斥，从第一次存储 await 前一直保护到归档完成。
 * 冲突直接拒绝并允许调用方重试，不等待嵌套调用，避免生命周期订阅中的重入死锁。
 * 此锁只约束当前进程的集合操作，不替代 Session 自身的执行忙碌检查。
 */
export class SessionLifecycle {
  private active_operations = 0;
  private archiving = false;

  /** 在非归档期间执行集合操作，并确保异常时释放占用。 */
  async access<T>(operation: () => Promise<T>): Promise<T> {
    this.require_access();
    this.active_operations += 1;
    try {
      return await operation();
    } finally {
      this.active_operations -= 1;
    }
  }

  /** 同步缓存回收在归档期间跳过，保持原句柄直到归档检查完成。 */
  is_archiving(): boolean {
    return this.archiving;
  }

  /** 同步缓存操作也必须遵守归档独占，避免运行中句柄被移出缓存。 */
  require_access(): void {
    if (this.archiving) throw new Error("session_lifecycle_busy: archive in progress; retry after it finishes");
  }

  /** 从扫描前独占集合；创建或恢复尚未完成时拒绝归档，保持目录快照稳定。 */
  async archive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.archiving || this.active_operations > 0) {
      throw new Error("session_lifecycle_busy: another Session lifecycle operation is in progress; retry after it finishes");
    }
    this.archiving = true;
    try {
      return await operation();
    } finally {
      this.archiving = false;
    }
  }
}
