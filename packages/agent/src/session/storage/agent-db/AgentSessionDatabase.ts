/**
 * Agent DB 连接拥有者与短事务边界。
 *
 * 仅在存储 Worker、内存模式唯一拥有者或离线隔离工具中创建。只读连接不建库，
 * 写连接只接受目标格式；新库创建必须显式授权。所有业务事务在本线程同步完成，
 * receipt 与变更同事务提交，IPC 丢失后可按 operation_id 查询真实提交事实。
 */
import { existsSync as exists_sync } from "node:fs";
import { randomBytes as random_bytes, randomUUID as random_uuid } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  AgentSessionDatabaseMetadata, AgentSessionDatabaseOptions, AgentSessionOperationReceipt,
} from "@/types/store/AgentSessionDatabase.js";
import { AGENT_SESSION_SCHEMA_SQL, AGENT_SESSION_SCHEMA_VERSION, assert_agent_session_schema } from "./AgentSessionSchema.js";
import { storage_digest } from "./AgentSessionCursor.js";

/** 一个 Agent 唯一写连接；只读租约可以独立创建只读实例。 */
export class AgentSessionDatabase {
  /** 仅存储引擎内部可用的同步连接，不能注入 Session 或宿主 Renderer。 */
  readonly database: DatabaseSync;
  /** 数据库的稳定拥有者与游标签名材料，不作为业务响应导出。 */
  get metadata(): AgentSessionDatabaseMetadata {
    this.assert_open();
    return this.database.prepare(`SELECT agent_id, generation, cursor_secret, first_business_write_at
      FROM storage_metadata WHERE singleton_id = 1`).get() as unknown as AgentSessionDatabaseMetadata;
  }
  private closed = false;
  private transaction_active = false;

  constructor(readonly options: AgentSessionDatabaseOptions) {
    if (!options.agent_id.trim() || (!options.database_path.startsWith("/") && options.database_path !== ":memory:" && !/^[A-Za-z]:[\\/]/u.test(options.database_path))) {
      throw new Error("session_storage_address_invalid");
    }
    const memory = options.database_path === ":memory:";
    if (memory && options.readonly) throw new Error("session_storage_memory_reader_requires_owner");
    if (!memory && !exists_sync(options.database_path) && (options.readonly || !options.allow_create)) {
      throw new Error("session_storage_not_found");
    }
    const database = new DatabaseSync(options.database_path, { readOnly: options.readonly ?? false });
    this.database = database;
    try {
      // 只读连接首次探测也可能争用 WAL 恢复锁，必须在任何 schema 读取前启用有限等待。
      database.exec("PRAGMA busy_timeout = 250;");
      const version = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
      const empty = version === 0 && !database.prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get();
      if (empty && options.allow_create && !options.readonly) {
        database.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;");
        try {
          database.exec(AGENT_SESSION_SCHEMA_SQL);
          database.prepare(`INSERT INTO storage_metadata
            (singleton_id, agent_id, format_version, generation, cursor_secret, created_at)
            VALUES (1, ?, ?, ?, ?, ?)`)
            .run(options.agent_id, AGENT_SESSION_SCHEMA_VERSION, random_uuid(), random_bytes(32), Date.now());
          database.exec(`PRAGMA user_version = ${AGENT_SESSION_SCHEMA_VERSION}; COMMIT;`);
        } catch (error) { database.exec("ROLLBACK"); throw error; }
      }
      assert_agent_session_schema(database, options.agent_id);
      database.exec("PRAGMA foreign_keys = ON;");
      if (options.readonly) database.exec("PRAGMA query_only = ON;");
      else if (!memory) {
        database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA wal_autocheckpoint = 1000;");
        if (process.platform === "darwin") database.exec("PRAGMA fullfsync = ON; PRAGMA checkpoint_fullfsync = ON;");
      }
    } catch (error) { database.close(); throw error; }
  }

  /** 目录页、COUNT 和当前页 Parts 必须在一个短读事务中读取。 */
  read<T>(operation: (database: DatabaseSync) => T): T {
    return this.transaction(false, operation);
  }

  /** 幂等写入；receipt 内容仅保存小型结果，不能复制 canonical 正文。 */
  write<T>(operation_id: string, request: unknown, operation: (database: DatabaseSync) => T): T {
    if (this.options.readonly) throw new Error("session_storage_readonly");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(operation_id)) {
      throw new Error("session_storage_operation_id_invalid");
    }
    const request_hash = storage_digest(request);
    return this.transaction(true, (database) => {
      const existing = database.prepare("SELECT request_hash, result FROM operation_receipts WHERE operation_id = ?").get(operation_id);
      if (existing) {
        if (existing.request_hash !== request_hash) throw new Error("session_storage_operation_conflict");
        return JSON.parse(String(existing.result)) as T;
      }
      const result = operation(database);
      const serialized = JSON.stringify(result);
      if (serialized === undefined || Buffer.byteLength(serialized) > 64 * 1024) {
        throw new Error("session_storage_receipt_invalid");
      }
      const committed_at = Date.now();
      database.prepare("INSERT INTO operation_receipts(operation_id, request_hash, result, committed_at) VALUES (?, ?, ?, ?)")
        .run(operation_id, request_hash, serialized, committed_at);
      database.prepare("UPDATE storage_metadata SET first_business_write_at = COALESCE(first_business_write_at, ?) WHERE singleton_id = 1")
        .run(committed_at);
      return result;
    });
  }

  /** 查询幂等提交事实；缺失只表示当前快照未见 receipt，不能推断失联写者已回滚。 */
  receipt(operation_id: string): AgentSessionOperationReceipt | null {
    this.assert_open();
    const row = this.database.prepare("SELECT request_hash, result, committed_at FROM operation_receipts WHERE operation_id = ?").get(operation_id);
    return row ? { request_hash: String(row.request_hash), result: JSON.parse(String(row.result)), committed_at: Number(row.committed_at) } : null;
  }

  /** 显式维护时推进世代；已有浏览租约必须关闭并重新打开，禁止继续使用旧签名材料。 */
  rotate_generation(): void {
    if (this.options.readonly) throw new Error("session_storage_readonly");
    this.transaction(true, (database) => {
      const generation = random_uuid();
      const cursor_secret = random_bytes(32);
      database.prepare("UPDATE storage_metadata SET generation = ?, cursor_secret = ? WHERE singleton_id = 1").run(generation, cursor_secret);
    });
  }

  /** 排空由上层调度器负责；连接只在没有事务时关闭。 */
  close(): void {
    if (this.closed) return;
    if (this.transaction_active) throw new Error("session_storage_transaction_active");
    this.database.close();
    this.closed = true;
  }

  /** 不允许 async callback 跨线程或跨外部 I/O 保持事务。 */
  private transaction<T>(write: boolean, operation: (database: DatabaseSync) => T): T {
    this.assert_open();
    if (this.transaction_active) throw new Error("session_storage_nested_transaction");
    this.database.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    this.transaction_active = true;
    try {
      const result = operation(this.database);
      if (result && typeof (result as { then?: unknown }).then === "function") throw new Error("session_storage_async_transaction_forbidden");
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* 原始失败保留，拥有者决定连接隔离。 */ }
      throw error;
    } finally { this.transaction_active = false; }
  }

  private assert_open(): void {
    if (this.closed) throw new Error("session_storage_closed");
  }
}
