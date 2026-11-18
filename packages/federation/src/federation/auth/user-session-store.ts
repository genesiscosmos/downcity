/**
 * 设备登录会话权威：摘要持久化、原子轮换、最后一次轮换恢复及整条会话撤销。
 * 刷新响应丢失时，旧凭证与相同请求 ID 可确定性恢复同一个后继秘密；
 * 数据库从不持有可用的刷新凭证。所有鉴权读取实时数据库事实。
 */
import type { Database } from "../../database/Database.js";
import type { UserSessionCredentials, UserSessionRecord } from "../../types/UserSession.js";
import { httpError } from "../../utils/helpers.js";
import type { UserTokenAuthority } from "./user-token-authority.js";

const idle_ttl_ms = 90 * 24 * 60 * 60_000;
const access_ttl_seconds = 15 * 60;

/** 高熵凭证摘要；也用于从仅客户端持有的秘密派生重试结果。 */
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Federation 自有登录会话，独立于具体 Accounts Provider。 */
export class UserSessionStore {
  constructor(private readonly database: Database, private readonly authority: UserTokenAuthority) {}

  /** 登录交换的私密证明决定唯一初始会话，重复交换不创建额外会话。 */
  async create(user_token: string, proof: string): Promise<UserSessionCredentials> {
    const payload = await this.authority.verify(user_token);
    const session_id = await digest(`session:${proof}`);
    const refresh_token = `ur_${session_id}.${await digest(`refresh:${proof}`)}`;
    await this.query(`INSERT INTO federation_user_sessions (session_id, user_id, token_hash, previous_hash, refresh_id_hash, expires_at, revoked) VALUES (?, ?, ?, '', '', ?, 0) ON CONFLICT (session_id) DO NOTHING`,
      [session_id, payload.user_id, await digest(refresh_token), Date.now() + idle_ttl_ms]);
    const row = await this.read(session_id);
    if (row.token_hash !== await digest(refresh_token) || row.user_id !== payload.user_id) throw httpError(409, "Login session already advanced");
    return await this.credentials(row, refresh_token);
  }

  /** CAS 轮换；丢失响应只能用原始请求 ID 在会话闲置到期前恢复。 */
  async refresh(refresh_token: string, refresh_id: string): Promise<UserSessionCredentials> {
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(refresh_id)) throw httpError(400, "random refresh_id required");
    const session_id = this.session_id(refresh_token);
    const token_hash = await digest(refresh_token);
    const refresh_id_hash = await digest(refresh_id);
    const next_token = `ur_${session_id}.${await digest(`rotate:${refresh_token}:${refresh_id}`)}`;
    const now = Date.now();
    await this.query(`UPDATE federation_user_sessions SET previous_hash = token_hash, token_hash = ?, refresh_id_hash = ?, expires_at = ? WHERE session_id = ? AND token_hash = ? AND revoked = 0 AND expires_at > ?`,
      [await digest(next_token), refresh_id_hash, now + idle_ttl_ms, session_id, token_hash, now]);
    const row = await this.read(session_id);
    if (row.previous_hash !== token_hash || row.refresh_id_hash !== refresh_id_hash
      || row.token_hash !== await digest(next_token)) {
      throw httpError(401, "Refresh credential expired or superseded");
    }
    return await this.credentials(row, next_token);
  }

  /** 使用当前或上一轮刷新凭证撤销，访问 JWT 过期也能退出。 */
  async revoke(refresh_token: string): Promise<void> {
    const session_id = this.session_id(refresh_token);
    const hash = await digest(refresh_token);
    await this.query(`UPDATE federation_user_sessions SET revoked = 1 WHERE session_id = ? AND (token_hash = ? OR previous_hash = ?)`, [session_id, hash, hash]);
    const rows = await this.query(`SELECT * FROM federation_user_sessions WHERE session_id = ?`, [session_id]);
    const row = rows[0];
    if (row && row.token_hash !== hash && row.previous_hash !== hash) throw httpError(401, "Invalid refresh credential");
  }

  /** 已验签访问凭证也可以撤销所属会话，不需要额外传回刷新秘密。 */
  async revoke_access(session_id: string, user_id: string): Promise<void> {
    await this.query(`UPDATE federation_user_sessions SET revoked = 1 WHERE session_id = ? AND user_id = ?`, [session_id, user_id]);
  }

  /** 所有访问令牌都检查会话；撤销与闲置到期立即生效。 */
  async require_active(session_id: string, user_id: string): Promise<void> {
    const row = await this.read(session_id);
    if (row.user_id !== user_id) throw httpError(401, "Invalid user session");
  }

  /** 已到期会话不再能通过 JWT 或刷新校验，可安全删除。 */
  async cleanup(): Promise<void> {
    await this.query(`DELETE FROM federation_user_sessions WHERE expires_at <= ?`, [Date.now()]);
  }

  private async credentials(row: UserSessionRecord, refresh_token: string): Promise<UserSessionCredentials> {
    const original_issued_at = Math.floor((row.expires_at - idle_ttl_ms) / 1000);
    const now = Math.floor(Date.now() / 1000);
    const issued_at = original_issued_at + access_ttl_seconds > now + 60 ? original_issued_at : now;
    return {
      user_token: await this.authority.sign({ user_id: row.user_id, ttl: access_ttl_seconds, metadata: { session_id: row.session_id } }, { issued_at, token_id: `session_${row.session_id}_${row.token_hash}` }),
      refresh_token,
      session_id: row.session_id,
      expires_at: new Date((issued_at + access_ttl_seconds) * 1000).toISOString(),
      refresh_expires_at: new Date(row.expires_at).toISOString(),
    };
  }

  private async read(session_id: string): Promise<UserSessionRecord> {
    const rows = await this.query(`SELECT * FROM federation_user_sessions WHERE session_id = ?`, [session_id]);
    const row = rows[0];
    if (!row || row.revoked || row.expires_at <= Date.now()) throw httpError(401, "User session expired or revoked");
    return row;
  }

  private session_id(token: string): string {
    const match = /^ur_([a-f0-9]{64})\.[a-f0-9]{64}$/.exec(token);
    if (!match) throw httpError(401, "Invalid refresh credential");
    return match[1]!;
  }

  private async query(sql: string, params: (string | number)[]): Promise<UserSessionRecord[]> {
    let index = 0;
    const statement = this.database.schema_id === "postgresql" ? sql.replace(/\?/g, () => `$${++index}`) : sql;
    return (await this.database.query<UserSessionRecord>({ sql: statement, params })).rows;
  }
}
