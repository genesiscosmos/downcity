/**
 * 数据库连接接口模块。
 *
 * 定义 Database / DbClient 抽象接口和 executeDDL 工具函数。
 * 不包含任何运行时特定的数据库驱动；外部只需要传入 Drizzle db。
 */

import type { SQL } from "drizzle-orm";
import type {
  CompiledQuery,
  D1BatchResult,
  D1PreparedStatement,
} from "./types/D1Transaction.js";

// ===========================================================================
// DbClient — 底层驱动
// ===========================================================================

/**
 * 底层数据库客户端接口。
 *
 * SQLite 用 exec()（同步），D1 用 exec()（异步），Postgres 用 unsafe()（异步）。
 * 适配器只需要提供其中一个方法即可。
 */
export interface DbClient {
  /** SQLite / D1 执行 DDL（D1 返回 Promise<void>，SQLite 返回 void） */
  exec?(sql: string): void | Promise<void>;
  /** Postgres 异步执行 DDL */
  unsafe?(sql: string, params?: unknown[]): Promise<unknown>;
  /** 关闭连接（可选） */
  close?(): void;
  /** 关闭连接（异步，可选） */
  end?(): Promise<void>;
  /** better-sqlite3 同步事务能力，用于识别可交互事务运行时。 */
  transaction?<TArgs extends unknown[], TResult>(
    callback: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult;
  /** D1 创建预编译语句。 */
  prepare?(query: string): D1PreparedStatement;
  /** D1 原子执行预编译语句列表。 */
  batch?(statements: D1PreparedStatement[]): Promise<D1BatchResult[]>;
}

// ===========================================================================
// Query — select 的链式结果（可 await + 可 .where/.orderBy/.limit）
// ===========================================================================

interface Query extends Promise<Record<string, unknown>[]> {
  where(cond: SQL | undefined): Promise<Record<string, unknown>[]>;
  orderBy(...cols: unknown[]): Promise<Record<string, unknown>[]>;
  limit(n: number): Promise<Record<string, unknown>[]>;
}

/**
 * 支持冲突忽略语义的 Drizzle insert query。
 *
 * SQLite、D1 与 Postgres 的 insert builder 都实现该公共子集，供系统初始化执行
 * 原子的“仅在不存在时插入”，避免跨 Worker isolate 的查询后写入竞态。
 */
/** 可编译为底层 SQL 的 Drizzle 查询。 */
interface CompilableQuery {
  /** 生成当前方言的 SQL 与参数。 */
  toSQL(): CompiledQuery;
}

interface InsertQuery extends PromiseLike<unknown>, CompilableQuery {
  /** 唯一约束冲突时不写入，也不抛出冲突错误。 */
  onConflictDoNothing(): InsertQuery;
}

// ===========================================================================
// Database — Drizzle 查询方法子集（SQLite / PG / D1 通用）
// ===========================================================================

/**
 * Drizzle select / insert / update / delete 的公共子集。
 *
 * 所有 Drizzle 方言实例这 4 个方法签名完全相同，
 * 只是泛型参数不同。此接口用 unknown 替代泛型参数，
 * 返回值用具体类型。各 Store 构造时从 DrizzleDB 转一次。
 */
export interface Database {
  select(): { from(t: unknown): Promise<Record<string, unknown>[]> | { where(c: SQL | undefined): Promise<Record<string, unknown>[]> } };
  insert(t: unknown): { values(v: Record<string, unknown> | Record<string, unknown>[]): InsertQuery };
  update(t: unknown): { set(v: Record<string, unknown>): { where(c: SQL | undefined): Promise<unknown> & CompilableQuery } };
  delete(t: unknown): { where(c: SQL | undefined): Promise<unknown> & CompilableQuery };
  /** PostgreSQL 等异步方言提供的原生事务入口。 */
  transaction?<TResult>(
    callback: (database: Database) => Promise<TResult>,
  ): Promise<TResult> | TResult;
}

// ===========================================================================
// executeDDL
// ===========================================================================

/**
 * 执行 DDL 语句。
 *
 * 自动适配同步（SQLite exec）、异步（D1 exec、Postgres unsafe）驱动。
 * D1 的 exec() 返回 Promise，统一 await 兼容所有情况。
 *
 * @param db - 包含 $client 的数据库实例
 * @param ddl - 要执行的 DDL SQL 字符串
 */
export async function executeDDL(db: { $client: DbClient }, ddl: string): Promise<void> {
  const c = db.$client;
  if (typeof c?.batch === "function" && typeof c?.prepare === "function") {
    const statement = c.prepare(ddl);
    if (typeof statement.run !== "function") throw new Error("D1 prepared statement does not expose run()");
    await statement.run();
    return;
  }
  if (typeof c?.exec === "function") { await c.exec(ddl); return; }
  if (typeof c?.unsafe === "function") { await c.unsafe(ddl); }
}
