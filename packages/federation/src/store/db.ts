/**
 * 数据库连接接口模块。
 *
 * 定义 Drizzle Database 查询接口。
 * 不包含任何运行时特定的数据库驱动；由 Database Adapter 在内部持有实现。
 */

import type { SQL } from "drizzle-orm";
import type { CompiledQuery } from "./types/CompiledQuery.js";

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
export interface DrizzleDatabase {
  select(): { from(t: unknown): Promise<Record<string, unknown>[]> | { where(c: SQL | undefined): Promise<Record<string, unknown>[]> } };
  insert(t: unknown): { values(v: Record<string, unknown> | Record<string, unknown>[]): InsertQuery };
  update(t: unknown): { set(v: Record<string, unknown>): { where(c: SQL | undefined): Promise<unknown> & CompilableQuery } };
  delete(t: unknown): { where(c: SQL | undefined): Promise<unknown> & CompilableQuery };
  /** PostgreSQL 等异步方言提供的原生事务入口。 */
  transaction?<TResult>(
    callback: (database: DrizzleDatabase) => Promise<TResult>,
  ): Promise<TResult> | TResult;
}
