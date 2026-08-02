/**
 * Accounts 服务数据库 schema 模块。
 *
 * 负责定义服务自身维护的业务资料表：
 * - user_profile：给产品层直接展示的用户资料
 * - login_state：CLI / 轮询式登录流程的临时 state
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * 用户资料表名。
 */
export const USER_PROFILE_TABLE = "auth_profiles";

/**
 * Accounts 服务登录 state 表名。
 */
export const ACCOUNTS_LOGIN_STATE_TABLE = "service_accounts_login_states";

/**
 * better-auth 用户表名。
 */
export const AUTH_USER_TABLE = "auth_users";

/**
 * better-auth account 表名。
 */
export const AUTH_ACCOUNT_TABLE = "auth_accounts";

/**
 * better-auth session 表名。
 */
export const AUTH_SESSION_TABLE = "auth_sessions";

/**
 * better-auth verification 表名。
 */
export const AUTH_VERIFICATION_TABLE = "auth_verifications";

/**
 * 产品层使用的用户资料。
 */
export interface UserProfileRow extends Record<string, unknown> {
  /**
   * 对应 better-auth `user.id`。
   */
  user_id: string;

  /**
   * 当前资料使用的主邮箱。
   */
  email: string;

  /**
   * 产品层展示名。
   */
  display_name: string;

  /**
   * 产品层头像 URL。
   */
  avatar_url: string;

  /**
   * 用户简介。
   *
   * 当前默认保留为空串，后续可给业务层编辑。
   */
  bio: string;

  /**
   * 首次创建时间。
   */
  created_at: string;

  /**
   * 最近更新时间。
   */
  updated_at: string;
}

/**
 * 登录轮询 state 记录。
 */
export interface AccountsLoginStateRow extends Record<string, unknown> {
  /**
   * 登录流程 ID；OAuth 流程中也作为 OAuth state。
   */
  state: string;

  /**
   * 登录成功后要签发到哪个 city。
   */
  bureau_id: string;

  /**
   * 第三方 provider 标识。
   */
  provider: string;

  /**
   * 完成登录后回填的 City user_token。
   */
  user_token: string;

  /**
   * state 创建时间戳（毫秒）。
   */
  created_at: number;
}

/**
 * 用户资料表。
 */
export const userProfiles = sqliteTable(USER_PROFILE_TABLE, {
  /**
   * 对应 better-auth `user.id`。
   */
  user_id: text("user_id").primaryKey(),

  /**
   * 当前主邮箱。
   */
  email: text("email").notNull(),

  /**
   * 展示名。
   */
  display_name: text("display_name").notNull(),

  /**
   * 头像 URL。
   */
  avatar_url: text("avatar_url").notNull(),

  /**
   * 简介。
   */
  bio: text("bio").notNull(),

  /**
   * 创建时间。
   */
  created_at: text("created_at").notNull(),

  /**
   * 更新时间。
   */
  updated_at: text("updated_at").notNull(),
});

export const accountsLoginStates = sqliteTable(ACCOUNTS_LOGIN_STATE_TABLE, {
  /**
   * 登录流程 ID；OAuth 流程中也作为 OAuth state。
   */
  state: text("state").primaryKey(),

  /**
   * 登录成功后要签发到哪个 city。
   */
  bureau_id: text("bureau_id").notNull(),

  /**
   * provider 标识。
   */
  provider: text("provider").notNull(),

  /**
   * 完成登录后回填的 City user_token。
   */
  user_token: text("user_token").notNull(),

  /**
   * 创建时间戳（毫秒）。
   */
  created_at: integer("created_at").notNull(),
});

/**
 * better-auth 用户表。
 */
export const authUsers = sqliteTable(AUTH_USER_TABLE, {
  /** 用户 ID。 */
  id: text("id").primaryKey(),
  /** 展示名。 */
  name: text("name").notNull(),
  /** 主邮箱。 */
  email: text("email").notNull().unique(),
  /** 邮箱是否已验证。 */
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
  /** 头像 URL。 */
  image: text("image"),
  /** 创建时间。 */
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  /** 更新时间。 */
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

/**
 * better-auth session 表。
 */
export const authSessions = sqliteTable(AUTH_SESSION_TABLE, {
  /** session ID。 */
  id: text("id").primaryKey(),
  /** 过期时间。 */
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  /** session token。 */
  token: text("token").notNull().unique(),
  /** 创建时间。 */
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  /** 更新时间。 */
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  /** IP 地址。 */
  ipAddress: text("ipAddress"),
  /** User-Agent。 */
  userAgent: text("userAgent"),
  /** 绑定用户 ID。 */
  userId: text("userId").notNull(),
});

/**
 * better-auth account 表。
 */
export const authAccounts = sqliteTable(AUTH_ACCOUNT_TABLE, {
  /** account ID。 */
  id: text("id").primaryKey(),
  /** 第三方账号 ID 或 credential account ID。 */
  accountId: text("accountId").notNull(),
  /** provider 标识。 */
  providerId: text("providerId").notNull(),
  /** 绑定用户 ID。 */
  userId: text("userId").notNull(),
  /** OAuth access token。 */
  accessToken: text("accessToken"),
  /** OAuth refresh token。 */
  refreshToken: text("refreshToken"),
  /** OAuth id token。 */
  idToken: text("idToken"),
  /** access token 过期时间。 */
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp_ms" }),
  /** refresh token 过期时间。 */
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp_ms" }),
  /** OAuth scope。 */
  scope: text("scope"),
  /** credential provider 的密码哈希。 */
  password: text("password"),
  /** 创建时间。 */
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  /** 更新时间。 */
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

/**
 * better-auth verification 表。
 */
export const authVerifications = sqliteTable(AUTH_VERIFICATION_TABLE, {
  /** verification ID。 */
  id: text("id").primaryKey(),
  /** verification 标识。 */
  identifier: text("identifier").notNull(),
  /** verification 值。 */
  value: text("value").notNull(),
  /** 过期时间。 */
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  /** 创建时间。 */
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  /** 更新时间。 */
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});
