/**
 * Agent Session 集合的进程内生命周期保护。
 *
 * 扫描归档子树时冻结创建、删除和使目录游标失效的清理，已有会话的恢复可以继续。
 * 计划确定后同步预留整棵子树，搬迁期间只拒绝涉及这些节点的操作。
 * 冲突直接拒绝，避免宿主生命周期回调重入等待自身；不提供跨进程存储锁。
 */
export class SessionLifecycle {
  private active_changes = 0;
  private scanning = false;
  private archiving = false;
  private readonly active_sessions = new Map<string, number>();
  private readonly archive_sessions = new Set<string>();

  /** 集合变更：扫描时拒绝，搬迁时仅检查目标会话及其直接父节点。 */
  async access<T>(operation: () => Promise<T>, session_keys: readonly string[] = []): Promise<T> {
    if (this.scanning) throw new Error("session_lifecycle_busy: archive scan in progress; retry after it finishes");
    return await this.with_sessions(session_keys, async () => {
      this.active_changes += 1;
      try { return await operation(); }
      finally { this.active_changes -= 1; }
    });
  }

  /** 恢复已有会话不改变父子关系，只保护该会话的句柄与存储。 */
  async read<T>(session_key: string, operation: () => Promise<T>): Promise<T> {
    return await this.with_sessions([session_key], operation);
  }

  /** 同步缓存回收不能移除正在使用或即将搬迁的句柄。 */
  is_busy(session_key: string): boolean {
    return this.archive_sessions.has(session_key) || this.active_sessions.has(session_key);
  }

  /** 计划完整后一次性预留所有节点；先检查再写入，失败时不留下部分预留。 */
  reserve_archive(session_keys: readonly string[]): void {
    if (!this.scanning) throw new Error("Session archive reservation requires an active scan");
    if (session_keys.some((key) => this.active_sessions.has(key))) {
      throw new Error("session_lifecycle_busy: a Session in the archive subtree is being accessed; retry after it finishes");
    }
    for (const key of session_keys) this.archive_sessions.add(key);
    this.scanning = false;
  }

  /** 扫描前冻结集合变更；搬迁完成或失败后释放全部节点预留。 */
  async archive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.archiving || this.active_changes > 0) {
      throw new Error("session_lifecycle_busy: another Session lifecycle operation is in progress; retry after it finishes");
    }
    this.archiving = true;
    this.scanning = true;
    try { return await operation(); }
    finally {
      this.archive_sessions.clear();
      this.scanning = false;
      this.archiving = false;
    }
  }

  /** 清空归档区与归档搬迁互斥，防止刚搬入的数据库被并发删除。 */
  async clean_archive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.archiving) throw new Error("session_lifecycle_busy: archive in progress; retry after it finishes");
    return await this.access(operation);
  }

  /** 从首次 await 前登记句柄使用，确保子树预留看见正在恢复的节点。 */
  private async with_sessions<T>(session_keys: readonly string[], operation: () => Promise<T>): Promise<T> {
    const keys = [...new Set(session_keys)];
    if (keys.some((key) => this.archive_sessions.has(key))) {
      throw new Error("session_lifecycle_busy: target Session or parent is being archived; retry after it finishes");
    }
    for (const key of keys) this.active_sessions.set(key, (this.active_sessions.get(key) ?? 0) + 1);
    try { return await operation(); }
    finally {
      for (const key of keys) {
        const count = this.active_sessions.get(key)! - 1;
        if (count > 0) this.active_sessions.set(key, count); else this.active_sessions.delete(key);
      }
    }
  }
}
