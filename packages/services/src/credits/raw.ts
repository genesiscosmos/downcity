/**
 * Credits 服务参数化数据库访问工具。
 *
 * 账务领域保留 SQL 命令所有权，具体查询和原子提交由 City Database Adapter 执行。
 */

import type { ServiceDatabaseContext } from "@downcity/city";
import type { CreditsRawCommand, CreditsRawRunResult } from "./types/RawDatabase.js";

/** 原子执行一组账务写命令。 */
export async function raw_atomic(
  database: ServiceDatabaseContext,
  commands: CreditsRawCommand[],
): Promise<CreditsRawRunResult[]> {
  return await database.atomic(commands);
}

/** 读取单行。 */
export async function raw_first<TRow extends Record<string, unknown>>(
  database: ServiceDatabaseContext,
  sql: string,
  params: unknown[],
): Promise<TRow | undefined> {
  return (await database.query<TRow>({ sql, params })).rows[0];
}

/** 读取多行。 */
export async function raw_all<TRow extends Record<string, unknown>>(
  database: ServiceDatabaseContext,
  sql: string,
  params: unknown[],
): Promise<TRow[]> {
  return (await database.query<TRow>({ sql, params })).rows;
}
