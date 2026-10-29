/**
 * Accounts 服务持久化边界。
 *
 * 本模块负责旧登录流程作废、better-auth 用户/账号/Session 和 Downcity Profile
 * 的数据库读写。登录流程与 HTTP 协议只通过这些显式方法访问认证事实。
 */

import type { ServiceDatabaseContext } from "@downcity/federation";
import { service_sql_database } from "../shared/database-sql.js";
import { listAccountUsageRegistrations } from "./admin-queries.js";
import { readPreparedFirst, runPrepared } from "./db.js";
import type { AuthAccountRow, AuthUserRow } from "./rows.js";
import {
  ACCOUNTS_LOGIN_STATE_TABLE,
  AUTH_ACCOUNT_TABLE,
  AUTH_USER_TABLE,
  USER_PROFILE_TABLE,
  type UserProfileRow,
} from "./schema.js";
import type { AccountsUsageRegistration } from "./types.js";
import type { AccountsPreparedStatement } from "./types/DatabaseStatement.js";
import type { AccountsProfileWriteInput } from "./types/AccountsStore.js";
import type { OAuthProviderProfile } from "./oauth.js";
import { normalizeBool, prefixedId } from "./utils.js";

/** Accounts 服务的数据库事实访问器。 */
export class AccountsStore {
  /** 当前方言的参数化数据库入口。 */
  private readonly database: ServiceDatabaseContext;

  constructor(database: ServiceDatabaseContext) {
    this.database = service_sql_database(database);
  }

  /** 向 UsageService 投影注册用户及首次创建时间。 */
  async list_usage_account_registrations(): Promise<AccountsUsageRegistration[]> {
    return await listAccountUsageRegistrations((sql) => this.prepare(sql));
  }

  /** 读取 better-auth Drizzle Adapter 使用的数据库实例。 */
  read_drizzle_database(): ServiceDatabaseContext["drizzle"] {
    return this.database.drizzle;
  }

  /** Explicitly invalidate legacy public-state login flows without touching account history. */
  async invalidate_legacy_logins(): Promise<void> {
    await this.database.query({ sql: `DELETE FROM ${ACCOUNTS_LOGIN_STATE_TABLE}`, params: [] });
    try {
      await this.database.atomic([
        { sql: `CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_unique ON ${AUTH_USER_TABLE} (email)`, params: [] },
        { sql: 'CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_unique ON auth_sessions (token)', params: [] },
        { sql: 'CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions ("userId")', params: [] },
        { sql: 'CREATE INDEX IF NOT EXISTS auth_accounts_user_idx ON auth_accounts ("userId")', params: [] },
        { sql: 'CREATE INDEX IF NOT EXISTS auth_verifications_identifier_idx ON auth_verifications (identifier)', params: [] },
      ]);
      await this.database.query({
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS auth_accounts_provider_identity_unique ON ${AUTH_ACCOUNT_TABLE} ("providerId", "accountId")`,
        params: [],
      });
    } catch {
      throw new Error("Accounts identity index could not be initialized. Check duplicate providerId/accountId records and database permissions; no accounts have been merged or deleted.");
    }
  }

  /** Resolve the provider's stable identity and update its profile without email linking or a native session. */
  async ensure_oauth_user(profile: OAuthProviderProfile, _request: Request): Promise<string> {
    const now = new Date().toISOString();
    const email = profile.email.trim().toLowerCase();
    const existing_account = await readPreparedFirst(
      this.prepare(`SELECT id, "userId" FROM ${AUTH_ACCOUNT_TABLE} WHERE "providerId" = ? AND "accountId" = ? LIMIT 1`),
      [profile.provider, profile.provider_user_id],
    ) as AuthAccountRow | null;

    if (!profile.provider_user_id.trim()) throw new Error("OAuth provider identity is missing");
    let user = existing_account
      ? await this.find_auth_user_by_id(existing_account.userId)
      : null;
    if (existing_account && !user) {
      throw new Error("OAuth account identity is inconsistent; contact account support");
    }
    const email_owner = email ? await this.find_auth_user_by_email(email) : null;
    if (email_owner && email_owner.id !== user?.id) {
      throw new Error("This email belongs to another account. Sign in to that account and use a verified account-linking or recovery flow; automatic linking is disabled.");
    }

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
      try {
        await this.database.atomic([
          {
            sql: `INSERT INTO ${AUTH_USER_TABLE} (id, email, "emailVerified", name, image, "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)`,
            params: [user.id, user.email, this.database.schema_id === "postgresql" ? Boolean(normalizeBool(user.emailVerified)) : normalizeBool(user.emailVerified), user.name, user.image, user.createdAt, user.updatedAt],
          },
          {
            sql: `INSERT INTO ${AUTH_ACCOUNT_TABLE} (id, "accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", scope, password, "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [prefixedId("acc"), profile.provider_user_id, profile.provider, user.id,
              null, null, null, null, null, null, null, now, now],
          },
        ]);
      } catch {
        throw new Error("OAuth account could not be created safely. The identity or email may already be registered; retry login or use account recovery. Automatic linking is disabled.");
      }
    } else {
      user = {
        ...user,
        // An established provider identity never overwrites the account's primary email.
        email: user.email,
        emailVerified: normalizeBool(user.emailVerified),
        name: profile.display_name || user.name,
        image: profile.avatar_url || user.image,
        updatedAt: now,
      };
      await runPrepared(
        this.prepare(`UPDATE ${AUTH_USER_TABLE} SET email = ?, "emailVerified" = ?, name = ?, image = ?, "updatedAt" = ? WHERE id = ?`),
        [user.email, this.database.schema_id === "postgresql" ? Boolean(normalizeBool(user.emailVerified)) : normalizeBool(user.emailVerified), user.name, user.image, user.updatedAt, user.id],
      );
    }

    if (existing_account) {
      await runPrepared(
        this.prepare(`UPDATE ${AUTH_ACCOUNT_TABLE} SET "updatedAt" = ? WHERE id = ?`),
        [now, existing_account.id],
      );
    }

    await this.upsert_profile({
      user_id: user.id,
      email: user.email,
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
      this.prepare(`SELECT id, email, "emailVerified", name, image, "createdAt", "updatedAt" FROM ${AUTH_USER_TABLE} WHERE id = ? LIMIT 1`),
      [user_id],
    ) as AuthUserRow | null;
  }

  /** 按规范化邮箱读取 better-auth 用户。 */
  private async find_auth_user_by_email(email: string): Promise<AuthUserRow | null> {
    return await readPreparedFirst(
      this.prepare(`SELECT id, email, "emailVerified", name, image, "createdAt", "updatedAt" FROM ${AUTH_USER_TABLE} WHERE lower(email) = ? LIMIT 1`),
      [email.toLowerCase()],
    ) as AuthUserRow | null;
  }
}
