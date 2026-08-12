/**
 * Federation 用户 token 签名密钥表。
 *
 * Federation 使用该系统表持久化 Ed25519 Key Ring。私钥只在服务端签发路径读取，
 * 对外 JWKS 仅返回 public_jwk，避免产品后端获得签发能力。
 */

import { pgTable, text as pgText } from "drizzle-orm/pg-core";
import { sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";

const FEDERATION_AUTH_KEY_TABLE = "federation_auth_keys";

/** active user token signing key 的数据库唯一索引名称。 */
export const FEDERATION_ACTIVE_AUTH_KEY_INDEX = "federation_auth_keys_one_active";

/**
 * 建立 active signing key 全局唯一约束。
 *
 * SQLite、Cloudflare D1 与 Postgres 都支持 partial unique index。以 status 作为索引列，
 * 只索引 active 记录，从而允许任意数量的 retired/revoked key 继续承担历史 token 验签。
 */
export const CREATE_FEDERATION_ACTIVE_AUTH_KEY_INDEX_SQL =
  `CREATE UNIQUE INDEX IF NOT EXISTS "${FEDERATION_ACTIVE_AUTH_KEY_INDEX}" `
  + `ON "${FEDERATION_AUTH_KEY_TABLE}" ("status") WHERE "status" = 'active'`;

/** Federation SQLite 签名密钥表。 */
export const sqlite_federation_auth_keys = sqliteTable(FEDERATION_AUTH_KEY_TABLE, {
  /** JWT protected header 使用的密钥 ID。 */
  key_id: sqliteText("key_id").primaryKey(),
  /** JOSE 签名算法，当前固定为 EdDSA。 */
  algorithm: sqliteText("algorithm").notNull(),
  /** 可公开发布的 Ed25519 Public JWK JSON。 */
  public_jwk: sqliteText("public_jwk").notNull(),
  /** 仅 Federation 签发路径可读的 Ed25519 Private JWK JSON。 */
  private_jwk: sqliteText("private_jwk").notNull(),
  /** 密钥生命周期状态。 */
  status: sqliteText("status").notNull(),
  /** 密钥创建时间。 */
  created_at: sqliteText("created_at").notNull(),
  /** 密钥停止签发时间；active 状态使用空字符串。 */
  retired_at: sqliteText("retired_at").notNull(),
});

/** Federation Postgres 签名密钥表。 */
export const pg_federation_auth_keys = pgTable(FEDERATION_AUTH_KEY_TABLE, {
  /** JWT protected header 使用的密钥 ID。 */
  key_id: pgText("key_id").primaryKey(),
  /** JOSE 签名算法，当前固定为 EdDSA。 */
  algorithm: pgText("algorithm").notNull(),
  /** 可公开发布的 Ed25519 Public JWK JSON。 */
  public_jwk: pgText("public_jwk").notNull(),
  /** 仅 Federation 签发路径可读的 Ed25519 Private JWK JSON。 */
  private_jwk: pgText("private_jwk").notNull(),
  /** 密钥生命周期状态。 */
  status: pgText("status").notNull(),
  /** 密钥创建时间。 */
  created_at: pgText("created_at").notNull(),
  /** 密钥停止签发时间；active 状态使用空字符串。 */
  retired_at: pgText("retired_at").notNull(),
});
