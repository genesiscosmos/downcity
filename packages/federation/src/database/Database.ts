/**
 * Federation Database 抽象基类。
 *
 * 公开方法统一维护生命周期和 Service 能力边界；具体 Driver、事务、DDL 与资源释放
 * 由独立 Database Adapter 通过受保护 Hook 实现。
 */

import type { CityTableApi } from "../store/table-api.js";
import type { DrizzleDatabase } from "../store/db.js";
import { DatabaseClosedError } from "../types/database/DatabaseError.js";
import type {
  DatabaseMutationResult,
  DatabaseQueryResult,
  DatabaseStatement,
  DatabaseTransaction,
  FederationTableSchema,
  ServiceDatabaseContext,
} from "../types/database/Database.js";

/** Federation 所有具体数据库 Adapter 的公共基类。 */
export abstract class Database<TDrizzle extends DrizzleDatabase = DrizzleDatabase> {
  /** Adapter 用于选择 Service 数据库声明的 Schema 标识。 */
  readonly schema_id: string;

  /** 当前 Adapter 拥有的 Drizzle 实例。 */
  protected readonly drizzle: TDrizzle;

  private disposed = false;

  protected constructor(input: { schema_id: string; drizzle: TDrizzle }) {
    const schema_id = String(input.schema_id ?? "").trim();
    if (!schema_id) throw new TypeError("Database schema_id is required");
    this.schema_id = schema_id;
    this.drizzle = input.drizzle;
  }

  /** 为物理 Schema 创建普通 Table API。 */
  table<TRow extends Record<string, unknown>>(
    schema: FederationTableSchema,
  ): CityTableApi<TRow> {
    this.assert_active();
    return this.on_table<TRow>(schema);
  }

  /** 幂等创建 Schema 对应的物理表。 */
  async ensure_table(schema: FederationTableSchema): Promise<void> {
    this.assert_active();
    await this.on_ensure_table(schema);
  }

  /** 执行当前 Schema 方言的幂等 DDL。 */
  async execute_ddl(statement: string): Promise<void> {
    this.assert_active();
    const normalized_statement = String(statement ?? "").trim();
    if (!normalized_statement) throw new TypeError("Database DDL statement is required");
    await this.on_execute_ddl(normalized_statement);
  }

  /** 执行单条参数化查询。 */
  async query<TRow extends Record<string, unknown>>(
    statement: DatabaseStatement,
  ): Promise<DatabaseQueryResult<TRow>> {
    this.assert_active();
    return await this.on_query<TRow>(normalize_statement(statement));
  }

  /** 原子执行一组预先构造的写命令。 */
  async atomic(statements: DatabaseStatement[]): Promise<DatabaseMutationResult[]> {
    this.assert_active();
    if (!Array.isArray(statements)) throw new TypeError("Database atomic statements must be an array");
    if (statements.length === 0) return [];
    return await this.on_atomic(statements.map(normalize_statement));
  }

  /** 执行跨表领域事务。 */
  async transaction<TResult>(
    handler: (transaction: DatabaseTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    this.assert_active();
    return await this.on_transaction(handler);
  }

  /** 创建只允许 Service 使用的数据库能力投影。 */
  service_context(): ServiceDatabaseContext {
    this.assert_active();
    return Object.freeze({
      schema_id: this.schema_id,
      drizzle: this.drizzle,
      query: <TRow extends Record<string, unknown>>(statement: DatabaseStatement) =>
        this.query<TRow>(statement),
      atomic: (statements: DatabaseStatement[]) => this.atomic(statements),
    });
  }

  /** 幂等释放 Adapter 拥有的资源。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.on_dispose();
  }

  /** 创建当前 Adapter 的普通 Table API。 */
  protected abstract on_table<TRow extends Record<string, unknown>>(
    schema: FederationTableSchema,
  ): CityTableApi<TRow>;

  /** 幂等创建物理表。 */
  protected abstract on_ensure_table(schema: FederationTableSchema): Promise<void>;

  /** 执行 DDL。 */
  protected abstract on_execute_ddl(statement: string): Promise<void>;

  /** 执行参数化查询。 */
  protected abstract on_query<TRow extends Record<string, unknown>>(
    statement: DatabaseStatement,
  ): Promise<DatabaseQueryResult<TRow>>;

  /** 原子执行预构造命令。 */
  protected abstract on_atomic(
    statements: DatabaseStatement[],
  ): Promise<DatabaseMutationResult[]>;

  /** 执行当前 Adapter 的事务算法。 */
  protected abstract on_transaction<TResult>(
    handler: (transaction: DatabaseTransaction) => Promise<TResult>,
  ): Promise<TResult>;

  /** 释放当前 Adapter 的 Driver 和内部资源。 */
  protected abstract on_dispose(): Promise<void>;

  /** 拒绝 dispose 后的全部公开操作。 */
  private assert_active(): void {
    if (this.disposed) throw new DatabaseClosedError();
  }
}

/** 归一化并复制调用方传入的参数化命令。 */
function normalize_statement(statement: DatabaseStatement): DatabaseStatement {
  const sql = String(statement?.sql ?? "").trim();
  if (!sql) throw new TypeError("Database SQL statement is required");
  if (!Array.isArray(statement.params)) throw new TypeError("Database SQL params must be an array");
  return { sql, params: [...statement.params] };
}
