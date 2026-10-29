/**
 * Credits 服务参数化数据库访问工具。
 *
 * 账务领域保留 SQL 命令所有权，具体查询和原子提交由 City Database Adapter 执行。
 */

import type { ServiceDatabaseContext } from "@downcity/federation";
import { bind_statement } from "../shared/database-sql.js";
import type { CreditsRawCommand, CreditsRawRunResult } from "./types/RawDatabase.js";

/** 原子执行一组账务写命令。 */
export async function raw_atomic(
  database: ServiceDatabaseContext,
  commands: CreditsRawCommand[],
): Promise<CreditsRawRunResult[]> {
  const statements = commands.map((command) => bind_statement(database.schema_id, command));
  if (database.schema_id !== "postgresql" || statements.length === 0) return await database.atomic(statements);
  // SQLite serializes writers. PostgreSQL must serialize these multi-statement ledger
  // decisions as well, including aggregate user limits and compensating updates.
  const results = await database.atomic([
    { sql: "SELECT pg_advisory_xact_lock(1685021550, 1668441459)", params: [] },
    ...statements,
  ]);
  return results.slice(1);
}

/** 读取单行。 */
export async function raw_first<TRow extends Record<string, unknown>>(
  database: ServiceDatabaseContext,
  sql: string,
  params: unknown[],
): Promise<TRow | undefined> {
  return (await database.query<TRow>(bind_statement(database.schema_id, { sql, params }))).rows[0];
}

/** 读取多行。 */
export async function raw_all<TRow extends Record<string, unknown>>(
  database: ServiceDatabaseContext,
  sql: string,
  params: unknown[],
): Promise<TRow[]> {
  return (await database.query<TRow>(bind_statement(database.schema_id, { sql, params }))).rows;
}
