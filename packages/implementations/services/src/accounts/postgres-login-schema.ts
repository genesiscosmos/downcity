/** accounts PostgreSQL 表声明；认证日期为 timestamptz，其他整数使用 bigint。 */
import { LOGIN_FLOW_TABLE } from "./login-schema.js";
import { bigint, pgTable, text } from "drizzle-orm/pg-core";
export const pg_login_flows = pgTable(LOGIN_FLOW_TABLE, {
  /** login_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  login_id: text("login_id").primaryKey(),
  /** secret_hash 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  secret_hash: text("secret_hash").notNull(),
  /** provider 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  provider: text("provider").notNull(),
  /** client_type 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  client_type: text("client_type").notNull(),
  /** oauth_state 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  oauth_state: text("oauth_state").notNull().unique(),
  /** browser_hash 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  browser_hash: text("browser_hash").notNull(),
  /** OAuth 产品回调地址：网站注册 callback 或 CLI/Desktop 本机 loopback。 */
  redirect_uri: text("redirect_uri").notNull(),
  /** 产品回调随机 state，独立于 Provider OAuth state。 */
  callback_state: text("callback_state").notNull(),
  /** S256 PKCE challenge，verifier 只存在于发起产品。 */
  code_challenge: text("code_challenge").notNull(),
  /** 浏览器交付的一次性授权码摘要，交换和幂等重试均需校验。 */
  authorization_code_hash: text("authorization_code_hash").notNull(),
  /** phase 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  phase: text("phase").notNull(),
  /** user_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  user_id: text("user_id").notNull(),
  /** user_token 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  user_token: text("user_token").notNull(),
  /** exchange_hash 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  exchange_hash: text("exchange_hash").notNull(),
  /** retry_until 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  retry_until: bigint("retry_until", { mode: "number" }).notNull(),
  /** expires_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  expires_at: bigint("expires_at", { mode: "number" }).notNull(),
});
export type LoginFlowRow = typeof pg_login_flows.$inferSelect;
