/**
 * Federation Service 数据库事务模块。
 *
 * 关键说明（中文）：
 * - PostgreSQL 使用 Drizzle 原生异步事务并绑定同一连接；
 * - better-sqlite3 使用同一连接的显式事务，并在进程内串行化事务；
 * - D1 不提供等价的交互式事务，调用时明确拒绝。
 */

import type { FederationDatabaseDialect } from "../federation/runtime.js";
import type { Database, DbClient } from "./db.js";

/** Federation Service 事务运行输入。 */
export interface RunServiceTransactionInput<TResult> {
  /** 当前 Drizzle 数据库。 */
  database: Database;
  /** 当前底层数据库 Client。 */
  client: DbClient;
  /** 当前数据库方言。 */
  dialect: FederationDatabaseDialect;
  /** 在同一事务连接上执行的业务函数。 */
  handler(database: Database): Promise<TResult>;
}

const database_operation_tails = new WeakMap<object, Promise<void>>();

/** 执行跨方言 Service 事务。 */
export async function run_service_transaction<TResult>(
  input: RunServiceTransactionInput<TResult>,
): Promise<TResult> {
  if (input.dialect === "postgresql") {
    if (typeof input.database.transaction !== "function") {
      throw new Error("PostgreSQL database does not expose transaction()");
    }
    return await input.database.transaction((database) => input.handler(database));
  }

  if (typeof input.client.transaction !== "function" || typeof input.client.exec !== "function") {
    throw new Error("Interactive SQLite service transactions are required; D1 is not supported");
  }

  return await with_database_operation_lock(input.database as object, async () => {
    await input.client.exec!("BEGIN IMMEDIATE");
    try {
      const result = await input.handler(input.database);
      await input.client.exec!("COMMIT");
      return result;
    } catch (error) {
      await input.client.exec!("ROLLBACK");
      throw error;
    }
  });
}

/**
 * 串行执行普通 Table API 操作。
 *
 * SQLite 事务跨越 Promise 检查点时，普通 Table API 不能插入同一连接；所有公开
 * TableApi 默认经过同一个协调器。事务内 TableApi 会显式跳过本层，避免重入死锁。
 */
export async function run_coordinated_database_operation<TResult>(
  database: object,
  handler: () => Promise<TResult>,
): Promise<TResult> {
  return await with_database_operation_lock(database, handler);
}

/** 同一 SQLite 连接上的事务必须串行执行。 */
async function with_database_operation_lock<TResult>(
  key: object,
  handler: () => Promise<TResult>,
): Promise<TResult> {
  const previous = database_operation_tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  database_operation_tails.set(key, tail);
  await previous;
  try {
    return await handler();
  } finally {
    release();
    if (database_operation_tails.get(key) === tail) {
      database_operation_tails.delete(key);
    }
  }
}
