/**
 * Desktop、CLI 和 City 共用的登录凭证仓储。
 * SQLite 立即事务协调多进程租约；网络请求不占用事务。刷新请求 ID 在发出前持久化，
 * 接管崩溃进程或恢复网络时使用同一次轮换，提交使用租约及旧凭证 CAS 防止退出复活。
 */
import { randomUUID } from "node:crypto";
import type { UserSessionCredentials, FetchLike } from "@downcity/downtown";
import type { LocalDatabase } from "../database/LocalDatabase.js";
import type { StoredUserSession } from "../types/UserSession.js";
import { LocalSettingRepository } from "./LocalSettingRepository.js";

/** 真实凭证失效，供宿主区别网络失败。 */
export class UserSessionExpiredError extends Error {
  readonly status = 401;
  constructor() { super("Login session expired or revoked; sign in again"); }
}

/** 每次请求读取共享凭证，运行中实例无需重新创建。 */
export class UserSessionRepository {
  private readonly settings: LocalSettingRepository;
  constructor(private readonly database: LocalDatabase) {
    this.settings = new LocalSettingRepository(database);
  }

  /** 登录成功后创建事实源；只在完成身份校验后调用。 */
  save(downtown_url: string, credentials: UserSessionCredentials): void {
    if (!credentials.session_id || !credentials.refresh_token || !credentials.user_token
      || !Number.isFinite(Date.parse(credentials.expires_at)) || !Number.isFinite(Date.parse(credentials.refresh_expires_at))) {
      throw new Error("Login exchange did not return renewable credentials");
    }
    this.database.transaction(() => {
      const previous = this.read(downtown_url, credentials.session_id);
      // 重复登录交付不得覆盖已轮换或撤销的凭证。
      if (previous?.invalidated) throw new UserSessionExpiredError();
      if (previous) return;
      this.settings.set(this.key(downtown_url, credentials.session_id), { ...credentials, downtown_url });
    });
  }

  /** 获取当前记录，绝不输出凭证。 */
  read(downtown_url: string, session_id: string): StoredUserSession | null {
    return this.settings.get<StoredUserSession>(this.key(downtown_url, session_id));
  }

  /** 先使本机所有运行时失去提交权限，再由调用方尽力执行远端撤销。 */
  invalidate(downtown_url: string, session_id: string): StoredUserSession | null {
    return this.database.transaction(() => {
      const row = this.read(downtown_url, session_id);
      if (row) this.invalidate_record(row);
      return row;
    });
  }

  /** 请求前续期；所有调用只发送一次业务请求，不重放业务副作用。 */
  async token(downtown_url: string, session_id: string, fetcher: FetchLike): Promise<string> {
    const owner = randomUUID();
    const deadline = Date.now() + 35_000;
    while (Date.now() < deadline) {
      const claim = this.database.transaction(() => {
        const row = this.require_active(downtown_url, session_id);
        if (Date.parse(row.expires_at) > Date.now() + 60_000) return { row, ready: true };
        if ((row.lease_until ?? 0) > Date.now()) return { row, ready: false };
        const next = { ...row, refresh_id: row.refresh_id || randomUUID(), lease_owner: owner, lease_until: Date.now() + 30_000 };
        this.settings.set(this.key(downtown_url, session_id), next);
        return { row: next, ready: false };
      });
      if (claim.ready) return claim.row.user_token;
      if (claim.row.lease_owner !== owner) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      const row = claim.row;
      try {
        const response = await fetcher(`${downtown_url.replace(/\/+$/, "")}/v1/accounts/refresh`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ refresh_token: row.refresh_token, refresh_id: row.refresh_id }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) await response.body?.cancel();
        if (response.status === 401) {
          this.database.transaction(() => {
            const current = this.read(downtown_url, session_id);
            if (current?.lease_owner === owner) this.invalidate_record(current);
          });
          throw new UserSessionExpiredError();
        }
        if (!response.ok) throw new Error(`Account renewal temporarily unavailable (${response.status})`);
        const next = await response.json() as UserSessionCredentials;
        if (next.session_id !== session_id || !next.refresh_token || !next.user_token
          || !Number.isFinite(Date.parse(next.expires_at)) || !Number.isFinite(Date.parse(next.refresh_expires_at))) throw new Error("Invalid account renewal response");
        return this.database.transaction(() => {
          const current = this.require_active(downtown_url, session_id);
          if (current.lease_owner !== owner || current.refresh_token !== row.refresh_token) throw new Error("Account renewal lease changed; retry request");
          this.settings.set(this.key(downtown_url, session_id), { ...next, downtown_url });
          return next.user_token;
        });
      } finally {
        this.database.transaction(() => {
          const current = this.read(downtown_url, session_id);
          if (current?.lease_owner === owner) this.settings.set(this.key(downtown_url, session_id), { ...current, lease_owner: undefined, lease_until: undefined });
        });
      }
    }
    throw new Error("Account renewal is busy; retry request");
  }

  /** 到期交给服务端判断：丢失响应可能已延长远端期限，本机保存的日期不能提前终止恢复。 */
  private require_active(downtown_url: string, session_id: string): StoredUserSession {
    const row = this.read(downtown_url, session_id);
    if (!row || row.invalidated || row.downtown_url !== downtown_url) throw new UserSessionExpiredError();
    return row;
  }
  private invalidate_record(row: StoredUserSession): void {
    this.settings.set(this.key(row.downtown_url, row.session_id), { ...row, user_token: "", refresh_token: "", refresh_id: undefined, invalidated: true, lease_owner: undefined, lease_until: undefined });
  }
  private key(downtown_url: string, session_id: string): string { return `user.session:${downtown_url}:${session_id}`; }
}
