/**
 * Accounts 服务数据库辅助模块。
 *
 * 基于 Database Adapter Statement 投影统一提供 first / all / run 能力。
 */

import type { AccountsPreparedStatement } from "./types/DatabaseStatement.js";

/**
 * 读取单行结果。
 */
export async function readPreparedFirst(
  statement: AccountsPreparedStatement,
  params: unknown[],
): Promise<Record<string, unknown> | null> {
  return await statement.bind(...params).first();
}

/**
 * 读取多行结果。
 */
export async function readPreparedAll(
  statement: AccountsPreparedStatement,
  params: unknown[],
): Promise<Record<string, unknown>[]> {
  return (await statement.bind(...params).all()).results;
}

/**
 * 执行写操作。
 */
export async function runPrepared(
  statement: AccountsPreparedStatement,
  params: unknown[],
): Promise<void> {
  await statement.bind(...params).run();
}
