/**
 * 本地 SQLite 数据库 Adapter。
 *
 * 本模块只提供 SQL 查询、写入、事务和连接生命周期，不创建表，也不理解 Agent、
 * Workspace、Plugin 或其他产品概念。
 */

import fs from "fs-extra";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  LocalDatabaseMutationResult,
  LocalDatabaseOptions,
  LocalPreparedStatement,
  LocalDatabaseQueryResult,
  LocalDatabaseStatement,
  LocalDatabaseTransaction,
} from "@/types/Database.js";

/** 基于 Node.js SQLite 的同步本地数据库 Adapter。 */
export class LocalDatabase implements LocalDatabaseTransaction {
  /** 原始连接只在 Adapter 内部使用。 */
  private readonly sqlite: DatabaseSync;

  /** 当前连接是否已经关闭。 */
  private closed = false;

  constructor(options: LocalDatabaseOptions) {
    const filename_input = String(options?.filename || "").trim();
    if (!filename_input) throw new TypeError("LocalDatabase filename is required");
    const filename = path.resolve(filename_input);
    fs.ensureDirSync(path.dirname(filename));
    this.sqlite = new DatabaseSync(filename);
    this.sqlite.exec("PRAGMA busy_timeout = 5000;");
    this.sqlite.exec("PRAGMA foreign_keys = ON;");
    if (options.wal !== false) this.sqlite.exec("PRAGMA journal_mode = WAL;");
  }

  /** 执行查询并返回普通对象数据行。 */
  query<TRow extends Record<string, unknown>>(
    statement: LocalDatabaseStatement,
  ): LocalDatabaseQueryResult<TRow> {
    this.assert_open();
    const rows = this.sqlite.prepare(statement.sql).all(...(statement.params ?? [])) as TRow[];
    return { rows: rows.map((row) => ({ ...row })) };
  }

  /** 创建一条可复用的参数化语句；Adapter 不解释 SQL 与返回行。 */
  prepare(sql: string): LocalPreparedStatement {
    this.assert_open();
    const statement = this.sqlite.prepare(sql);
    return {
      get: (...params) => statement.get(...params) as Record<string, unknown> | undefined,
      all: (...params) => statement.all(...params) as Record<string, unknown>[],
      run: (...params) => {
        const result = statement.run(...params);
        return {
          changes: result.changes,
          last_insert_rowid: result.lastInsertRowid,
        };
      },
    };
  }

  /** 执行写入并返回修改数量。 */
  execute(statement: LocalDatabaseStatement): LocalDatabaseMutationResult {
    this.assert_open();
    const result = this.sqlite.prepare(statement.sql).run(...(statement.params ?? []));
    return {
      changes: Number(result.changes ?? 0),
      last_insert_rowid: result.lastInsertRowid,
    };
  }

  /** 执行不需要参数和结果的 SQL。 */
  execute_script(sql: string): void {
    this.assert_open();
    this.sqlite.exec(sql);
  }

  /** 在单个立即事务中同步执行一组业务操作；异步回调会回滚并报错。 */
  transaction<TResult>(handler: (transaction: LocalDatabaseTransaction) => TResult): TResult {
    this.assert_open();
    this.sqlite.exec("BEGIN IMMEDIATE;");
    try {
      const result = handler(this);
      if (is_promise_like(result)) {
        throw new TypeError("LocalDatabase.transaction handler must be synchronous");
      }
      this.sqlite.exec("COMMIT;");
      return result;
    } catch (error) {
      this.sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  /** 幂等关闭数据库连接。 */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.sqlite.close();
  }

  /** 断言连接仍然可用。 */
  private assert_open(): void {
    if (this.closed) throw new Error("LocalDatabase is closed");
  }
}

/** 判断事务回调是否错误返回了 PromiseLike。 */
function is_promise_like(value: unknown): value is PromiseLike<unknown> {
  return Boolean(
    value
    && (typeof value === "object" || typeof value === "function")
    && typeof (value as PromiseLike<unknown>).then === "function",
  );
}
