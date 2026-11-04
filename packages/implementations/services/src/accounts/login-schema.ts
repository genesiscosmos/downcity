/** 短期登录事务表；全部 OAuth 使用产品回调授权码与 S256 PKCE。 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** 临时凭据使用独立版本表，数据库准备时丢弃旧版未完成登录，不迁移凭据。 */
export const LOGIN_FLOW_TABLE = "service_accounts_login_flows_v4";
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
  /** web、cli 或 desktop 产品交互方式。 */
  client_type: text("client_type").notNull(),
  /** Independent, single-use OAuth state, never a claim credential. */
  oauth_state: text("oauth_state").notNull().unique(),
  /** Browser binding cookie digest; empty until external authorization begins. */
  browser_hash: text("browser_hash").notNull(),
  /** OAuth 产品回调 URL；网站为注册 BFF，CLI/Desktop 为本机 loopback。 */
  redirect_uri: text("redirect_uri").notNull(),
  /** 产品回调随机 state，与 Provider OAuth state 独立。 */
  callback_state: text("callback_state").notNull(),
  /** PKCE S256 challenge；verifier 只保留在发起产品。 */
  code_challenge: text("code_challenge").notNull(),
  /** 浏览器交付的一次性授权码摘要，仅允许绑定的 exchange_id 幂等重试。 */
  authorization_code_hash: text("authorization_code_hash").notNull(),
  /** State-machine stage, advanced using conditional SQL. */
  phase: text("phase").notNull(),
  /** 已认证、等待授权码交换的用户身份。 */
  user_id: text("user_id").notNull(),
  /** Bounded exchange retry response, erased after expiry. */
  user_token: text("user_token").notNull(),
  /** Digest of the sole accepted exchange idempotency identifier. */
  exchange_hash: text("exchange_hash").notNull(),
  /** End of exchange response retry window, epoch milliseconds. */
  retry_until: integer("retry_until").notNull(),
  /** Absolute expiry of the flow, epoch milliseconds. */
  expires_at: integer("expires_at").notNull(),
});

/** Raw persisted flow; properties inherit documented schema meanings. */
export type LoginFlowRow = typeof login_flows.$inferSelect;
