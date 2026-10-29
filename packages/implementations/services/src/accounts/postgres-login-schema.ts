/** accounts PostgreSQL 表声明；认证日期为 timestamptz，其他整数使用 bigint。 */
import { LOGIN_FLOW_TABLE } from "./login-schema.js";
import { bigint, boolean, timestamp, pgTable, text } from "drizzle-orm/pg-core";
export const pg_login_flows = pgTable(LOGIN_FLOW_TABLE, {
  /** login_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  login_id: text("login_id").primaryKey(),
  /** secret_hash 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  secret_hash: text("secret_hash").notNull(),
  /** bureau_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  bureau_id: text("bureau_id").notNull(),
  /** provider 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  provider: text("provider").notNull(),
  /** client_type 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  client_type: text("client_type").notNull(),
  /** oauth_state 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  oauth_state: text("oauth_state").notNull().unique(),
  /** browser_hash 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  browser_hash: text("browser_hash").notNull(),
  /** code_hash 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  code_hash: text("code_hash").notNull(),
  /** csrf_hash 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  csrf_hash: text("csrf_hash").notNull(),
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
  /** attempts 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  attempts: bigint("attempts", { mode: "number" }).notNull(),
  /** expires_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  expires_at: bigint("expires_at", { mode: "number" }).notNull(),
});
export type LoginFlowRow = typeof pg_login_flows.$inferSelect;
