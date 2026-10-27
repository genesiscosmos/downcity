/** Isolated v2 login storage. Legacy state rows are invalidated during initialization. */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** New table prevents legacy public state values from becoming claim credentials. */
export const LOGIN_FLOW_TABLE = "service_accounts_login_flows_v2";
/** Ephemeral login facts; all bearer credentials except the bounded exchange response are hashed. */
export const login_flows = sqliteTable(LOGIN_FLOW_TABLE, {
  /** Public, non-authorizing flow identifier. */
  login_id: text("login_id").primaryKey(),
  /** SHA-256 of the initiating client's private claim credential. */
  secret_hash: text("secret_hash").notNull(),
  /** Target Bureau validated against the Federation registry. */
  bureau_id: text("bureau_id").notNull(),
  /** Configured authentication provider. */
  provider: text("provider").notNull(),
  /** Explicit web, cli, desktop or BFF device interaction mode. */
  client_type: text("client_type").notNull(),
  /** Independent, single-use OAuth state, never a claim credential. */
  oauth_state: text("oauth_state").notNull().unique(),
  /** Browser binding cookie digest; empty until external authorization begins. */
  browser_hash: text("browser_hash").notNull(),
  /** Digest of external client's human confirmation code. */
  code_hash: text("code_hash").notNull(),
  /** Digest of the browser confirmation form's CSRF nonce. */
  csrf_hash: text("csrf_hash").notNull(),
  /** State-machine stage, advanced using conditional SQL. */
  phase: text("phase").notNull(),
  /** Authenticated identity awaiting explicit browser approval. */
  user_id: text("user_id").notNull(),
  /** Bounded exchange retry response, erased after expiry. */
  user_token: text("user_token").notNull(),
  /** Digest of the sole accepted exchange idempotency identifier. */
  exchange_hash: text("exchange_hash").notNull(),
  /** End of exchange response retry window, epoch milliseconds. */
  retry_until: integer("retry_until").notNull(),
  /** Number of submitted device-code confirmations, capped at five. */
  attempts: integer("attempts").notNull(),
  /** Absolute expiry of the flow, epoch milliseconds. */
  expires_at: integer("expires_at").notNull(),
});

/** Raw persisted flow; properties inherit documented schema meanings. */
export type LoginFlowRow = typeof login_flows.$inferSelect;
