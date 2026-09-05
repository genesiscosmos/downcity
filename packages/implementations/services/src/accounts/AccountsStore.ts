/**
 * Accounts 服务持久化边界。
 *
 * 本模块唯一负责 login state、better-auth 用户/账号/Session 和 Downcity Profile
 * 的数据库读写。登录流程与 HTTP 协议只通过这些显式方法访问认证事实。
 */

import type { ServiceDatabaseContext } from "@downcity/federation";
import { listAccountUsageRegistrations } from "./admin-queries.js";
import { readPreparedFirst, runPrepared } from "./db.js";
import type { AuthAccountRow, AuthUserRow, LoginStateRow } from "./rows.js";
import {
  ACCOUNTS_LOGIN_STATE_TABLE,
  AUTH_ACCOUNT_TABLE,
  AUTH_SESSION_TABLE,
  AUTH_USER_TABLE,
  USER_PROFILE_TABLE,
  type UserProfileRow,
} from "./schema.js";
import type { AccountsUsageRegistration } from "./types.js";
import type { AccountsPreparedStatement } from "./types/DatabaseStatement.js";
import type { AccountsProfileWriteInput } from "./types/AccountsStore.js";
import type { OAuthProviderProfile } from "./oauth.js";
import { normalizeBool, prefixedId, randomToken } from "./utils.js";

/** 登录 state 的最长有效时间。 */
const LOGIN_STATE_TTL_MS = 5 * 60 * 1000;
/** OAuth 登录写入的 better-auth Session 有效时间。 */
const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Accounts 服务的数据库事实访问器。 */
export class AccountsStore {
  constructor(private readonly database: ServiceDatabaseContext) {}

  /** 向 UsageService 投影注册用户及首次创建时间。 */
  async list_usage_account_registrations(): Promise<AccountsUsageRegistration[]> {
    return await listAccountUsageRegistrations((sql) => this.prepare(sql));
  }

  /** 读取 better-auth Drizzle Adapter 使用的数据库实例。 */
  read_drizzle_database(): ServiceDatabaseContext["drizzle"] {
    return this.database.drizzle;
  }

  /** 创建一次登录 state。 */
  async create_login_state(
    bureau_id: string,
    provider: string,
    state: string,
    user_token = "",
  ): Promise<void> {
    await runPrepared(
      this.prepare(`INSERT INTO ${ACCOUNTS_LOGIN_STATE_TABLE} (state, bureau_id, provider, user_token, created_at) VALUES (?, ?, ?, ?, ?)`),
      [state, bureau_id, provider, user_token, Date.now()],
    );
  }

  /** 读取未过期的登录 state，并清理命中的过期记录。 */
  async read_login_state(state: string): Promise<LoginStateRow | null> {
    const row = await readPreparedFirst(
      this.prepare(`SELECT state, bureau_id, provider, user_token, created_at FROM ${ACCOUNTS_LOGIN_STATE_TABLE} WHERE state = ?`),
      [state],
    ) as LoginStateRow | null;
    if (!row) return null;
    if (Date.now() - Number(row.created_at) > LOGIN_STATE_TTL_MS) {
      await runPrepared(
        this.prepare(`DELETE FROM ${ACCOUNTS_LOGIN_STATE_TABLE} WHERE state = ?`),
        [state],
      );
      return null;
    }
    return row;
  }

  /** 把最终 User Token 回填到登录 state。 */
  async resolve_login_state(state: string, user_token: string): Promise<void> {
    await runPrepared(
      this.prepare(`UPDATE ${ACCOUNTS_LOGIN_STATE_TABLE} SET user_token = ? WHERE state = ?`),
      [user_token, state],
    );
  }

  /** 确保 OAuth 用户和账号存在，并记录当前认证 Session 与 Profile。 */
  async ensure_oauth_user(profile: OAuthProviderProfile, request: Request): Promise<string> {
    const now = new Date().toISOString();
    const email = profile.email.trim().toLowerCase();
    const existing_account = await readPreparedFirst(
      this.prepare(`SELECT id, userId FROM ${AUTH_ACCOUNT_TABLE} WHERE providerId = ? AND accountId = ? LIMIT 1`),
      [profile.provider, profile.provider_user_id],
    ) as AuthAccountRow | null;

    let user = existing_account
      ? await this.find_auth_user_by_id(existing_account.userId)
      : email
        ? await this.find_auth_user_by_email(email)
        : null;

    if (!user) {
      user = {
        id: prefixedId("usr"),
        email,
        emailVerified: profile.email_verified ? 1 : 0,
        name: profile.display_name,
        image: profile.avatar_url || null,
        createdAt: now,
        updatedAt: now,
      };
      await runPrepared(
        this.prepare(`INSERT INTO ${AUTH_USER_TABLE} (id, email, emailVerified, name, image, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`),
        [user.id, user.email, normalizeBool(user.emailVerified), user.name, user.image, user.createdAt, user.updatedAt],
      );
    } else {
      user = {
        ...user,
        email,
        emailVerified: normalizeBool(user.emailVerified) || profile.email_verified ? 1 : 0,
        name: profile.display_name || user.name,
        image: profile.avatar_url || user.image,
        updatedAt: now,
      };
      await runPrepared(
        this.prepare(`UPDATE ${AUTH_USER_TABLE} SET email = ?, emailVerified = ?, name = ?, image = ?, updatedAt = ? WHERE id = ?`),
        [user.email, normalizeBool(user.emailVerified), user.name, user.image, user.updatedAt, user.id],
      );
    }

    if (!existing_account) {
      await runPrepared(
        this.prepare(`INSERT INTO ${AUTH_ACCOUNT_TABLE} (id, accountId, providerId, userId, accessToken, refreshToken, idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
        [
          prefixedId("acc"),
          profile.provider_user_id,
          profile.provider,
          user.id,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          now,
          now,
        ],
      );
    } else {
      await runPrepared(
        this.prepare(`UPDATE ${AUTH_ACCOUNT_TABLE} SET updatedAt = ? WHERE id = ?`),
        [now, existing_account.id],
      );
    }

    await runPrepared(
      this.prepare(`INSERT INTO ${AUTH_SESSION_TABLE} (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      [
        prefixedId("sess"),
        new Date(Date.now() + AUTH_SESSION_TTL_MS).toISOString(),
        randomToken(32),
        now,
        now,
        String(request.headers.get("x-forwarded-for") ?? ""),
        String(request.headers.get("user-agent") ?? ""),
        user.id,
      ],
    );

    await this.upsert_profile({
      user_id: user.id,
      email,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
    });
    return user.id;
  }

  /** 读取一条 Downcity 用户 Profile。 */
  async read_profile(user_id: string): Promise<UserProfileRow | null> {
    return await readPreparedFirst(
      this.prepare(`SELECT user_id, email, display_name, avatar_url, bio, created_at, updated_at FROM ${USER_PROFILE_TABLE} WHERE user_id = ? LIMIT 1`),
      [user_id],
    ) as UserProfileRow | null;
  }

  /** 创建或更新 Downcity 用户 Profile。 */
  async upsert_profile(input: AccountsProfileWriteInput): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.read_profile(input.user_id);
    if (existing) {
      await runPrepared(
        this.prepare(`UPDATE ${USER_PROFILE_TABLE} SET email = ?, display_name = ?, avatar_url = ?, updated_at = ? WHERE user_id = ?`),
        [
          input.email || existing.email,
          input.display_name || existing.display_name,
          input.avatar_url || existing.avatar_url,
          now,
          input.user_id,
        ],
      );
      return;
    }

    await runPrepared(
      this.prepare(`INSERT INTO ${USER_PROFILE_TABLE} (user_id, email, display_name, avatar_url, bio, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`),
      [input.user_id, input.email, input.display_name, input.avatar_url, "", now, now],
    );
  }

  /** 创建适配 better-auth 辅助查询的 PreparedStatement。 */
  prepare(sql: string): AccountsPreparedStatement {
    return {
      bind: (...params: unknown[]) => ({
        first: async () => (await this.database.query({ sql, params })).rows[0] ?? null,
        all: async () => ({ results: (await this.database.query({ sql, params })).rows }),
        run: async () => await this.database.query({ sql, params }),
      }),
    };
  }

  /** 按 ID 读取 better-auth 用户。 */
  private async find_auth_user_by_id(user_id: string): Promise<AuthUserRow | null> {
    return await readPreparedFirst(
      this.prepare(`SELECT id, email, emailVerified, name, image, createdAt, updatedAt FROM ${AUTH_USER_TABLE} WHERE id = ? LIMIT 1`),
      [user_id],
    ) as AuthUserRow | null;
  }

  /** 按规范化邮箱读取 better-auth 用户。 */
  private async find_auth_user_by_email(email: string): Promise<AuthUserRow | null> {
    return await readPreparedFirst(
      this.prepare(`SELECT id, email, emailVerified, name, image, createdAt, updatedAt FROM ${AUTH_USER_TABLE} WHERE lower(email) = ? LIMIT 1`),
      [email.toLowerCase()],
    ) as AuthUserRow | null;
  }
}
