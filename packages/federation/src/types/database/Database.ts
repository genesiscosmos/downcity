/** Federation Database 公共类型模块。 */

import type { AnyPgTable } from "drizzle-orm/pg-core";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import type { CityTableApi } from "../../store/table-api.js";
import type { DrizzleDatabase } from "../../store/db.js";

/** Federation 当前支持的 Drizzle Table Schema。 */
export type FederationTableSchema = AnySQLiteTable | AnyPgTable;

/** 参数化数据库命令。 */
export interface DatabaseStatement {
  /** 使用当前 Adapter SQL 方言的命令文本。 */
  sql: string;
  /** 按占位符顺序绑定的参数。 */
  params: unknown[];
}

/** 参数化查询结果。 */
export interface DatabaseQueryResult<TRow extends Record<string, unknown>> {
  /** 查询返回的数据行。 */
  rows: TRow[];
  /** 命令影响的记录数量。 */
  changes: number;
}

/** 原子写命令结果。 */
export interface DatabaseMutationResult {
  /** 当前命令影响的记录数量。 */
  changes: number;
}

/** 绑定当前物理事务的数据库入口。 */
export interface DatabaseTransaction {
  /** 为当前事务创建绑定的 Table API。 */
  table<TRow extends Record<string, unknown>>(
    schema: FederationTableSchema,
  ): CityTableApi<TRow>;
}

/** 投影给 Service 的受限数据库能力。 */
export interface ServiceDatabaseContext {
  /** 当前 Service 使用的 Schema 标识。 */
  readonly schema_id: string;
  /** better-auth 等 ORM 集成使用的只读 Drizzle 实例。 */
  readonly drizzle: DrizzleDatabase;
  /** 执行单条参数化查询。 */
  query<TRow extends Record<string, unknown>>(
    statement: DatabaseStatement,
  ): Promise<DatabaseQueryResult<TRow>>;
  /** 原子执行预先构造的写命令。 */
  atomic(statements: DatabaseStatement[]): Promise<DatabaseMutationResult[]>;
}
