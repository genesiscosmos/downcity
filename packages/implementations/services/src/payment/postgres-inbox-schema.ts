/** payment PostgreSQL 表声明；认证日期为 timestamptz，其他整数使用 bigint。 */
import { bigint, boolean, timestamp, pgTable, text } from "drizzle-orm/pg-core";
export const pg_payment_inbox = pgTable("service_payment_inbox", {
  /** event_id 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  event_id: text("event_id").primaryKey(),
  /** provider 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  provider: text("provider").notNull(),
  /** event_json 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  event_json: text("event_json").notNull(),
  /** status 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  status: text("status").notNull(),
  /** attempts 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  attempts: bigint("attempts", { mode: "number" }).notNull(),
  /** next_attempt_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  next_attempt_at: bigint("next_attempt_at", { mode: "number" }).notNull(),
  /** lease 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  lease: text("lease").notNull(),
  /** lease_until 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  lease_until: bigint("lease_until", { mode: "number" }).notNull(),
  /** last_error 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  last_error: text("last_error").notNull(),
  /** created_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  created_at: text("created_at").notNull(),
  /** updated_at 持久化字段；与同名 SQLite 字段具有相同业务含义。 */
  updated_at: text("updated_at").notNull(),
});
