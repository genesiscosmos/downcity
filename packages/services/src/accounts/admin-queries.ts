/**
 * Accounts 管理侧查询。
 *
 * 关键说明（中文）
 * - 管理侧列表只依赖原始 SQL statement，和登录流程解耦。
 * - 拆出后 AccountsService 主模块专注路由、认证和 token 签发。
 */

import { readPreparedAll } from "./db.js";
import {
  AUTH_SESSION_TABLE,
  AUTH_USER_TABLE,
  USER_PROFILE_TABLE,
} from "./schema.js";
import type { AccountsPreparedStatement } from "./types/DatabaseStatement.js";

/**
 * 原始 statement 创建函数。
 */
type RawPrepare = (sql: string) => AccountsPreparedStatement;

/**
 * 读取管理侧用户列表。
 */
export async function listAccountUsers(raw_prepare: RawPrepare): Promise<Record<string, unknown>[]> {
  return await readPreparedAll(
    raw_prepare(
      `SELECT
        u.id as user_id,
        u.email as auth_email,
        u.emailVerified as email_verified,
        u.name as auth_name,
        u.image as auth_image,
        u.createdAt as auth_created_at,
        u.updatedAt as auth_updated_at,
        p.email as profile_email,
        p.display_name,
        p.avatar_url,
        p.bio,
        p.created_at as profile_created_at,
        p.updated_at as profile_updated_at
      FROM ${AUTH_USER_TABLE} u
      LEFT JOIN ${USER_PROFILE_TABLE} p ON p.user_id = u.id
      ORDER BY u.createdAt DESC`,
    ),
    [],
  );
}

/**
 * 读取管理侧 session 列表。
 */
export async function listAccountSessions(raw_prepare: RawPrepare): Promise<Record<string, unknown>[]> {
  const rows = await readPreparedAll(
    raw_prepare(`SELECT id as session_id, userId as user_id, expiresAt as expires_at, createdAt as created_at FROM ${AUTH_SESSION_TABLE} ORDER BY expiresAt DESC`),
    [],
  );
  return rows.map((row) => ({
    ...row,
    status: read_time(row.expires_at) > Date.now() ? "active" : "expired",
  }));
}

/**
 * 兼容 Date、秒级时间戳、毫秒级时间戳和字符串时间。
 */
function read_time(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return normalize_epoch_time(value);
  if (typeof value === "string" && value.trim()) {
    const numeric_value = Number(value);
    if (Number.isFinite(numeric_value) && /^-?\d+(?:\.\d+)?$/u.test(value.trim())) return normalize_epoch_time(numeric_value);
    return Date.parse(value);
  }
  return Number.NaN;
}

/**
 * 兼容秒级与毫秒级 Unix 时间戳。
 */
function normalize_epoch_time(value: number): number {
  return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
}
