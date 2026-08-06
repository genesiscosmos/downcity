/**
 * Federation 管理员身份与管理会话 Store。
 *
 * 该 Store 是管理员凭证、失败锁定和 Session 生命周期的唯一事实源。部署
 * 管理员创建与恢复由部署控制面完成；Runtime 只读取数据库中的当前管理员状态。
 */

import type { CityTableApi } from "../../store/table-api.js";
import { base64UrlEncodeBytes, httpError, randomSecret } from "../../utils/helpers.js";
import { verify_federation_admin_password } from "./admin-password.js";
import type {
  FederationAdministratorRecord,
  FederationAdminLoginInput,
  FederationAdminLoginResult,
  FederationAdminSessionRecord,
} from "./types.js";

const OWNER_SLOT = "owner";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const DUMMY_PASSWORD_HASH = "pbkdf2_sha256$210000$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** 已验证的管理员会话投影。 */
export interface ResolvedFederationAdminSession {
  /** 当前管理员 ID。 */
  admin_id: string;
  /** 当前管理会话公开 ID。 */
  session_id: string;
  /** 当前管理会话到期时间。 */
  expires_at: string;
}

/** Federation 管理员 Store。 */
export class FederationAdminStore {
  constructor(
    private readonly administrator_table: CityTableApi<FederationAdministratorRecord>,
    private readonly session_table: CityTableApi<FederationAdminSessionRecord>,
  ) {}

  /** 使用管理员 ID 和密码创建固定期限的管理会话。 */
  async login(input: FederationAdminLoginInput): Promise<FederationAdminLoginResult> {
    const admin_id = String(input?.admin_id ?? "").trim();
    const password = typeof input?.password === "string" ? input.password : "";
    if (!admin_id || !password) throw httpError(401, "Invalid administrator credentials");

    const administrator = await this.get_owner();
    const now_ms = Date.now();
    const locked_until_ms = Date.parse(administrator?.locked_until || "");
    const is_locked = Boolean(administrator && Number.isFinite(locked_until_ms) && locked_until_ms > now_ms);
    if (is_locked) throw httpError(429, "Administrator login temporarily locked");
    const password_matches = await verify_federation_admin_password(
      password,
      administrator?.password_hash ?? DUMMY_PASSWORD_HASH,
    );
    const authenticated = Boolean(
      administrator
      && administrator.status === "active"
      && administrator.admin_id === admin_id
      && password_matches
    );
    if (!authenticated) {
      if (administrator) await this.record_failed_login(administrator, now_ms);
      throw httpError(401, "Invalid administrator credentials");
    }
    if (!administrator) throw httpError(401, "Invalid administrator credentials");

    if (administrator.failed_attempts !== "0" || administrator.locked_until) {
      await this.administrator_table.update({
        where: { owner_slot: OWNER_SLOT },
        values: { failed_attempts: "0", locked_until: "", updated_at: new Date(now_ms).toISOString() },
      });
    }
    const session_token = `fadm_${randomSecret(32)}`;
    const session_id = `fads_${randomSecret(16)}`;
    const created_at = new Date(now_ms).toISOString();
    const expires_at = new Date(now_ms + SESSION_TTL_MS).toISOString();
    await this.prune_sessions(now_ms);
    await this.session_table.insert({
      session_id,
      admin_id: administrator.admin_id,
      token_hash: await hash_session_token(session_token),
      status: "active",
      created_at,
      expires_at,
      last_seen_at: created_at,
      revoked_at: "",
    });
    return { admin_id: administrator.admin_id, session_token, expires_at };
  }

  /** 将 Bearer Token 解析为当前有效管理员会话。 */
  async resolve_session(token: string): Promise<ResolvedFederationAdminSession | undefined> {
    if (!token.startsWith("fadm_")) return undefined;
    const rows = await this.session_table.select({ token_hash: await hash_session_token(token) });
    const session = rows[0];
    if (!session || session.status !== "active" || Date.parse(session.expires_at) <= Date.now()) return undefined;
    const administrator = await this.get_owner();
    if (!administrator || administrator.status !== "active" || administrator.admin_id !== session.admin_id) {
      return undefined;
    }
    const now = new Date().toISOString();
    if (Date.now() - Date.parse(session.last_seen_at) >= 5 * 60 * 1000) {
      await this.session_table.update({
        where: { session_id: session.session_id, status: "active" },
        values: { last_seen_at: now },
      });
    }
    return {
      admin_id: administrator.admin_id,
      session_id: session.session_id,
      expires_at: session.expires_at,
    };
  }

  /** 撤销当前 Bearer Token 对应的管理会话。 */
  async logout(token: string): Promise<void> {
    if (!token.startsWith("fadm_")) return;
    const now = new Date().toISOString();
    await this.session_table.update({
      where: { token_hash: await hash_session_token(token), status: "active" },
      values: { status: "revoked", revoked_at: now },
    });
  }

  /** 读取固定 owner 管理员。 */
  private async get_owner(): Promise<FederationAdministratorRecord | undefined> {
    return (await this.administrator_table.select({ owner_slot: OWNER_SLOT }))[0];
  }

  /** 记录一次失败并在达到阈值后锁定登录。 */
  private async record_failed_login(
    administrator: FederationAdministratorRecord,
    now_ms: number,
  ): Promise<void> {
    const next_attempts = Math.max(0, Number(administrator.failed_attempts) || 0) + 1;
    const should_lock = next_attempts >= MAX_FAILED_ATTEMPTS;
    await this.administrator_table.update({
      where: { owner_slot: OWNER_SLOT },
      values: {
        failed_attempts: should_lock ? "0" : String(next_attempts),
        locked_until: should_lock ? new Date(now_ms + LOCK_DURATION_MS).toISOString() : "",
        updated_at: new Date(now_ms).toISOString(),
      },
    });
  }

  /** 删除已过期或已撤销的历史会话，避免长期运行后无界增长。 */
  private async prune_sessions(now_ms: number): Promise<void> {
    const sessions = await this.session_table.select();
    await Promise.all(sessions
      .filter((session) => session.status === "revoked" || Date.parse(session.expires_at) <= now_ms)
      .map((session) => this.session_table.delete({ session_id: session.session_id })));
  }
}

/** 对 Session Token 做不可逆摘要。 */
async function hash_session_token(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return base64UrlEncodeBytes(new Uint8Array(digest));
}
