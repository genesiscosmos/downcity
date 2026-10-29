/** accounts PostgreSQL 表声明；认证日期为 timestamptz，其他整数使用 bigint。 */
import { USER_PROFILE_TABLE, ACCOUNTS_LOGIN_STATE_TABLE, AUTH_USER_TABLE, AUTH_ACCOUNT_TABLE, AUTH_SESSION_TABLE, AUTH_VERIFICATION_TABLE } from "./schema.js";
import { bigint, boolean, timestamp, pgTable, text } from "drizzle-orm/pg-core";
export const pg_user_profiles = pgTable(USER_PROFILE_TABLE, {
  /** user_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  user_id: text("user_id").primaryKey(),
  /** email 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  email: text("email").notNull(),
  /** display_name 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  display_name: text("display_name").notNull(),
  /** avatar_url 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  avatar_url: text("avatar_url").notNull(),
  /** bio 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  bio: text("bio").notNull(),
  /** created_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  created_at: text("created_at").notNull(),
  /** updated_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  updated_at: text("updated_at").notNull(),
});
export const pg_accounts_login_states = pgTable(ACCOUNTS_LOGIN_STATE_TABLE, {
  /** state 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  state: text("state").primaryKey(),
  /** bureau_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  bureau_id: text("bureau_id").notNull(),
  /** provider 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  provider: text("provider").notNull(),
  /** user_token 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  user_token: text("user_token").notNull(),
  /** created_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  created_at: bigint("created_at", { mode: "number" }).notNull(),
});
export const pg_auth_users = pgTable(AUTH_USER_TABLE, {
  /** id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  id: text("id").primaryKey(),
  /** name 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  name: text("name").notNull(),
  /** email 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  email: text("email").notNull().unique(),
  /** emailVerified 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  emailVerified: boolean("emailVerified").notNull().default(false),
  /** image 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  image: text("image"),
  /** createdAt 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  /** updatedAt 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull(),
});
export const pg_auth_sessions = pgTable(AUTH_SESSION_TABLE, {
  /** id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  id: text("id").primaryKey(),
  /** expiresAt 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }).notNull(),
  /** token 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  token: text("token").notNull().unique(),
  /** createdAt 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  /** updatedAt 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull(),
  /** ipAddress 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  ipAddress: text("ipAddress"),
  /** userAgent 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  userAgent: text("userAgent"),
  /** userId 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  userId: text("userId").notNull(),
});
export const pg_auth_accounts = pgTable(AUTH_ACCOUNT_TABLE, {
  /** id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  id: text("id").primaryKey(),
  /** accountId 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  accountId: text("accountId").notNull(),
  /** providerId 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  providerId: text("providerId").notNull(),
  /** userId 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  userId: text("userId").notNull(),
  /** accessToken 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  accessToken: text("accessToken"),
  /** refreshToken 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  refreshToken: text("refreshToken"),
  /** idToken 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  idToken: text("idToken"),
  /** accessTokenExpiresAt 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { withTimezone: true, mode: "date" }),
  /** refreshTokenExpiresAt 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { withTimezone: true, mode: "date" }),
  /** scope 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  scope: text("scope"),
  /** password 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  password: text("password"),
  /** createdAt 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  /** updatedAt 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull(),
});
export const pg_auth_verifications = pgTable(AUTH_VERIFICATION_TABLE, {
  /** id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  id: text("id").primaryKey(),
  /** identifier 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  identifier: text("identifier").notNull(),
  /** value 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  value: text("value").notNull(),
  /** expiresAt 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }).notNull(),
  /** createdAt 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  /** updatedAt 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull(),
});
