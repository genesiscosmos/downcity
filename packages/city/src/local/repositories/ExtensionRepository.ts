/**
 * 扩展项目的唯一 SQLite 仓储。
 * 保留移除身份和操作结果；快照完整准备后才提交引用。仓储不持有根租约或运行资源。
 */
import type { LocalDatabase } from "../database/LocalDatabase.js";
import type { ExtensionRecord, ExtensionOperation } from "../types/Extension.js";

/** 项目及操作的单一持久化实现。 */
export class ExtensionRepository {
  constructor(private readonly database: LocalDatabase, writable = false) {
    if (writable) database.execute_script(`
      CREATE TABLE IF NOT EXISTS extensions (
        extension_id TEXT PRIMARY KEY,
        source_identity TEXT NOT NULL UNIQUE,
        record_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS extension_binding (singleton INTEGER PRIMARY KEY CHECK(singleton=1), entry_id TEXT);
      CREATE TABLE IF NOT EXISTS extension_operations (
        operation_id TEXT PRIMARY KEY,
        record_json TEXT NOT NULL
      );
    `);
  }

  /** 旧根在只读查询中不触发迁移。 */
  private exists(): boolean {
    return Boolean(this.database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='extensions'").get());
  }

  /** 查询包含已移除身份的记录。 */
  get(extension_id: string): ExtensionRecord | null {
    if (!this.exists()) return null;
    const row = this.database.prepare("SELECT record_json FROM extensions WHERE extension_id=?").get(extension_id);
    return row ? JSON.parse(String(row.record_json)) as ExtensionRecord : null;
  }

  /** 持久化的是稳定连接引用，绝不保存 Federation 实例或凭证。 */
  selected_federation(): string | null {
    const exists = this.database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='extension_binding'").get();
    if (!exists) return null;
    return this.database.prepare("SELECT entry_id FROM extension_binding WHERE singleton=1").get()?.entry_id as string | null ?? null;
  }

  /** 用户显式选择或解除连接；普通移除不得自动调用。 */
  select_federation(entry_id: string | null): void {
    this.database.prepare("INSERT INTO extension_binding VALUES(1, ?) ON CONFLICT(singleton) DO UPDATE SET entry_id=excluded.entry_id").run(entry_id);
  }

  /** 精确查找规范来源；展示名不参与身份。 */
  find_source(identity: string): ExtensionRecord | null {
    if (!this.exists()) return null;
    const row = this.database.prepare("SELECT record_json FROM extensions WHERE source_identity=?").get(identity);
    return row ? JSON.parse(String(row.record_json)) as ExtensionRecord : null;
  }

  /** 列出项目；默认不显示移除项。 */
  list(include_removed = false): ExtensionRecord[] {
    if (!this.exists()) return [];
    return this.database.prepare("SELECT record_json FROM extensions ORDER BY extension_id").all()
      .map((row) => JSON.parse(String(row.record_json)) as ExtensionRecord)
      .filter((record) => include_removed || record.status !== "removed");
  }

  /** 在调用方租约内提交整个记录；不泄漏部分能力状态。 */
  save(record: ExtensionRecord): void {
    this.database.prepare("INSERT INTO extensions VALUES (?, ?, ?) ON CONFLICT(extension_id) DO UPDATE SET source_identity=excluded.source_identity, record_json=excluded.record_json")
      .run(record.extension_id, record.source.identity, JSON.stringify(record));
  }

  /** 已接受操作结果跨进程保留。 */
  get_operation(operation_id: string): ExtensionOperation | null {
    if (!this.exists()) return null;
    const row = this.database.prepare("SELECT record_json FROM extension_operations WHERE operation_id=?").get(operation_id);
    return row ? JSON.parse(String(row.record_json)) as ExtensionOperation : null;
  }

  /** 项目变更与操作结果在同一事务中提交。 */
  commit(record: ExtensionRecord, operation: ExtensionOperation): void {
    this.database.transaction(() => {
      this.save(record);
      this.database.prepare("INSERT INTO extension_operations VALUES (?, ?) ON CONFLICT(operation_id) DO UPDATE SET record_json=excluded.record_json")
        .run(operation.operation_id, JSON.stringify(operation));
    });
  }
}
