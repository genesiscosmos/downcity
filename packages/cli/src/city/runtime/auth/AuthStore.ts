/**
 * 统一账户存储层。
 *
 * 关键点（中文）
 * - 该模块只负责 `auth_*` 表的读写，不处理密码校验与 HTTP 语义。
 * - 数据仍落在控制面全局 SQLite 中，与现有平台配置共享底层存储。
 */

import fs from "fs-extra";
import path from "node:path";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { getPlatformStoreDbPath } from "@/city/process/registry/CityPaths.js";
import type { AuthIssuedToken, AuthTokenSummary } from "@downcity/type";
import {
  AUTH_DEFAULT_ROLES,
  AUTH_PERMISSION_DESCRIPTIONS,
  AUTH_PERMISSION_KEYS,
  type AuthDefaultRoleName,
  type AuthPermissionKey,
} from "@downcity/type";
import type {
  AuthAuditLog,
  AuthTokenRecord,
  AuthUser,
} from "@downcity/type";
import {
  nowIso,
  normalizeNonEmptyText,
  optionalTrimmedText,
  type PlatformStoreContext,
} from "@/city/runtime/store/StoreShared.js";
import { ensurePlatformStoreSchema } from "@/city/runtime/store/StoreSchema.js";

/**
 * AuthStore 构造参数。
 */
export interface AuthStoreOptions {
  /**
   * SQLite 数据库路径。
   */
  dbPath?: string;
}

type SqliteRow = Record<string, unknown>;

/**
 * AuthStore 门面。
 */
export class AuthStore {
  private readonly sqlite: Database.Database;
  private readonly context: PlatformStoreContext;

  constructor(options: AuthStoreOptions = {}) {
    const dbPath = path.resolve(options.dbPath || getPlatformStoreDbPath());
    fs.ensureDirSync(path.dirname(dbPath));
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma("journal_mode = WAL");
    this.context = {
      sqlite: this.sqlite,
    };
    ensurePlatformStoreSchema(this.context);
  }

  /**
   * 关闭数据库连接。
   */
  close(): void {
    this.sqlite.close();
  }

  /**
   * 返回当前用户数量。
   */
  countUsers(): number {
    const row = this.sqlite.prepare("SELECT COUNT(*) as count FROM auth_users").get() as
      | { count?: unknown }
      | undefined;
    return Number(row?.count || 0);
  }

  /**
   * 幂等写入默认角色与权限目录。
   */
  ensureDefaultCatalog(): void {
    const now = nowIso();
    const tx = this.sqlite.transaction(() => {
      const roleIds = new Map<AuthDefaultRoleName, string>();
      for (const role of AUTH_DEFAULT_ROLES) {
        const existing = this.sqlite
          .prepare("SELECT id FROM auth_roles WHERE name = ?")
          .get(role.name) as { id?: unknown } | undefined;
        if (existing?.id) {
          this.sqlite
            .prepare(
              "UPDATE auth_roles SET description = ?, updated_at = ? WHERE id = ?",
            )
            .run(role.description, now, String(existing.id));
          roleIds.set(role.name, String(existing.id));
        } else {
          const id = nanoid();
          this.sqlite
            .prepare(
              "INSERT INTO auth_roles (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            )
            .run(id, role.name, role.description, now, now);
          roleIds.set(role.name, id);
        }
      }

      const permissionIds = new Map<AuthPermissionKey, string>();
      for (const permission of AUTH_PERMISSION_KEYS) {
        const description = AUTH_PERMISSION_DESCRIPTIONS[permission];
        const existing = this.sqlite
          .prepare("SELECT id FROM auth_permissions WHERE key = ?")
          .get(permission) as { id?: unknown } | undefined;
        if (existing?.id) {
          this.sqlite
            .prepare(
              "UPDATE auth_permissions SET description = ?, updated_at = ? WHERE id = ?",
            )
            .run(description, now, String(existing.id));
          permissionIds.set(permission, String(existing.id));
        } else {
          const id = nanoid();
          this.sqlite
            .prepare(
              "INSERT INTO auth_permissions (id, key, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            )
            .run(id, permission, description, now, now);
          permissionIds.set(permission, id);
        }
      }

      for (const role of AUTH_DEFAULT_ROLES) {
        const roleId = roleIds.get(role.name);
        if (!roleId) continue;
        for (const permission of role.permissions) {
          const permissionId = permissionIds.get(permission);
          if (!permissionId) continue;
          this.sqlite
            .prepare(
              "INSERT OR IGNORE INTO auth_role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?)",
            )
            .run(nanoid(), roleId, permissionId, now);
        }
      }
    });
    tx();
  }

  /**
   * 创建用户。
   */
  createUser(input: {
    username: string;
    password_hash: string;
    display_name?: string;
    status?: "active" | "disabled";
  }): AuthUser {
    const id = nanoid();
    const now = nowIso();
    const username = normalizeNonEmptyText(input.username, "username");
    const password_hash = normalizeNonEmptyText(input.password_hash, "password_hash");
    const display_name = optionalTrimmedText(input.display_name);
    const status = input.status === "disabled" ? "disabled" : "active";
    this.sqlite
      .prepare(
        "INSERT INTO auth_users (id, username, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, username, password_hash, display_name || null, status, now, now);
    return {
      id,
      username,
      password_hash,
      display_name,
      status,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * 根据用户名读取用户。
   */
  findUserByUsername(usernameInput: string): AuthUser | null {
    const username = normalizeNonEmptyText(usernameInput, "username");
    const row = this.sqlite
      .prepare("SELECT * FROM auth_users WHERE username = ?")
      .get(username) as SqliteRow | undefined;
    return row ? this.toAuthUser(row) : null;
  }

  /**
   * 根据用户 ID 读取用户。
   */
  getUserById(userIdInput: string): AuthUser | null {
    const user_id = normalizeNonEmptyText(userIdInput, "user_id");
    const row = this.sqlite
      .prepare("SELECT * FROM auth_users WHERE id = ?")
      .get(user_id) as SqliteRow | undefined;
    return row ? this.toAuthUser(row) : null;
  }

  /**
   * 读取全部用户列表。
   */
  listUsers(): AuthUser[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM auth_users ORDER BY username ASC")
      .all() as SqliteRow[];
    return rows.map((row) => this.toAuthUser(row));
  }

  /**
   * 更新用户基础资料。
   */
  updateUser(params: {
    user_id: string;
    display_name?: string;
    status?: "active" | "disabled";
  }): AuthUser | null {
    const user_id = normalizeNonEmptyText(params.user_id, "user_id");
    const current = this.getUserById(user_id);
    if (!current) return null;
    const nextDisplayName = optionalTrimmedText(params.display_name);
    const nextStatus = params.status === "disabled" ? "disabled" : "active";
    const updated_at = nowIso();
    this.sqlite
      .prepare(
        "UPDATE auth_users SET display_name = ?, status = ?, updated_at = ? WHERE id = ?",
      )
      .run(nextDisplayName || null, nextStatus, updated_at, user_id);
    return this.getUserById(user_id);
  }

  /**
   * 更新用户密码哈希。
   */
  updateUserPasswordHash(params: {
    user_id: string;
    password_hash: string;
  }): AuthUser | null {
    const user_id = normalizeNonEmptyText(params.user_id, "user_id");
    const password_hash = normalizeNonEmptyText(params.password_hash, "password_hash");
    const current = this.getUserById(user_id);
    if (!current) return null;
    const updated_at = nowIso();
    this.sqlite
      .prepare(
        "UPDATE auth_users SET password_hash = ?, updated_at = ? WHERE id = ?",
      )
      .run(password_hash, updated_at, user_id);
    return this.getUserById(user_id);
  }

  /**
   * 给用户绑定角色。
   */
  assignRoleToUser(params: { user_id: string; roleName: AuthDefaultRoleName | string }): void {
    const user_id = normalizeNonEmptyText(params.user_id, "user_id");
    const role = this.sqlite
      .prepare("SELECT id FROM auth_roles WHERE name = ?")
      .get(normalizeNonEmptyText(params.roleName, "roleName")) as { id?: unknown } | undefined;
    if (!role?.id) throw new Error(`Unknown role: ${params.roleName}`);
    this.sqlite
      .prepare(
        "INSERT OR IGNORE INTO auth_user_roles (id, user_id, role_id, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(nanoid(), user_id, String(role.id), nowIso());
  }

  /**
   * 读取用户角色名列表。
   */
  listRoleNamesByUserId(userIdInput: string): string[] {
    const user_id = normalizeNonEmptyText(userIdInput, "user_id");
    const rows = this.sqlite
      .prepare(
        `
          SELECT DISTINCT roles.name as name
          FROM auth_roles roles
          INNER JOIN auth_user_roles links ON links.role_id = roles.id
          WHERE links.user_id = ?
          ORDER BY roles.name ASC
        `,
      )
      .all(user_id) as Array<{ name?: unknown }>;
    return rows.map((row) => String(row.name || "").trim()).filter(Boolean);
  }

  /**
   * 清空用户当前绑定的全部角色。
   */
  clearRolesByUserId(userIdInput: string): void {
    const user_id = normalizeNonEmptyText(userIdInput, "user_id");
    this.sqlite
      .prepare("DELETE FROM auth_user_roles WHERE user_id = ?")
      .run(user_id);
  }

  /**
   * 用新的角色集合覆盖用户角色绑定。
   */
  replaceRolesByUserId(params: {
    user_id: string;
    roleNames: string[];
  }): string[] {
    const user_id = normalizeNonEmptyText(params.user_id, "user_id");
    const roleNames = [...new Set(params.roleNames.map((item) => String(item || "").trim()).filter(Boolean))];
    const tx = this.sqlite.transaction(() => {
      this.clearRolesByUserId(user_id);
      for (const roleName of roleNames) {
        this.assignRoleToUser({
          user_id,
          roleName,
        });
      }
    });
    tx();
    return this.listRoleNamesByUserId(user_id);
  }

  /**
   * 统计拥有指定角色且处于 active 状态的用户数量。
   */
  countActiveUsersByRole(roleNameInput: string): number {
    const roleName = normalizeNonEmptyText(roleNameInput, "roleName");
    const row = this.sqlite
      .prepare(
        `
          SELECT COUNT(DISTINCT users.id) as count
          FROM auth_users users
          INNER JOIN auth_user_roles user_roles ON user_roles.user_id = users.id
          INNER JOIN auth_roles roles ON roles.id = user_roles.role_id
          WHERE users.status = 'active' AND roles.name = ?
        `,
      )
      .get(roleName) as { count?: unknown } | undefined;
    return Number(row?.count || 0);
  }

  /**
   * 读取用户权限 key 列表。
   */
  listPermissionKeysByUserId(userIdInput: string): AuthPermissionKey[] {
    const user_id = normalizeNonEmptyText(userIdInput, "user_id");
    const rows = this.sqlite
      .prepare(
        `
          SELECT DISTINCT perms.key as key
          FROM auth_permissions perms
          INNER JOIN auth_role_permissions rp ON rp.permission_id = perms.id
          INNER JOIN auth_user_roles ur ON ur.role_id = rp.role_id
          WHERE ur.user_id = ?
          ORDER BY perms.key ASC
        `,
      )
      .all(user_id) as Array<{ key?: unknown }>;
    return rows
      .map((row) => String(row.key || "").trim())
      .filter(Boolean) as AuthPermissionKey[];
  }

  /**
   * 创建 token 记录。
   */
  createToken(input: {
    user_id: string;
    name: string;
    token_hash: string;
    expires_at?: string;
  }): AuthTokenRecord {
    const id = nanoid();
    const now = nowIso();
    const user_id = normalizeNonEmptyText(input.user_id, "user_id");
    const name = normalizeNonEmptyText(input.name, "name");
    const token_hash = normalizeNonEmptyText(input.token_hash, "token_hash");
    const expires_at = optionalTrimmedText(input.expires_at);
    this.sqlite
      .prepare(
        "INSERT INTO auth_tokens (id, user_id, name, token_hash, expires_at, revoked_at, last_used_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)",
      )
      .run(id, user_id, name, token_hash, expires_at || null, now, now);
    return {
      id,
      user_id,
      name,
      token_hash,
      expires_at,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * 根据 token 哈希读取记录。
   */
  findTokenByHash(tokenHashInput: string): AuthTokenRecord | null {
    const token_hash = normalizeNonEmptyText(tokenHashInput, "token_hash");
    const row = this.sqlite
      .prepare("SELECT * FROM auth_tokens WHERE token_hash = ?")
      .get(token_hash) as SqliteRow | undefined;
    return row ? this.toAuthToken(row) : null;
  }

  /**
   * 根据 token ID 读取记录。
   */
  getTokenById(tokenIdInput: string): AuthTokenRecord | null {
    const token_id = normalizeNonEmptyText(tokenIdInput, "token_id");
    const row = this.sqlite
      .prepare("SELECT * FROM auth_tokens WHERE id = ?")
      .get(token_id) as SqliteRow | undefined;
    return row ? this.toAuthToken(row) : null;
  }

  /**
   * 读取用户 token 列表。
   */
  listTokensByUserId(userIdInput: string): AuthTokenRecord[] {
    const user_id = normalizeNonEmptyText(userIdInput, "user_id");
    const rows = this.sqlite
      .prepare("SELECT * FROM auth_tokens WHERE user_id = ? ORDER BY created_at DESC")
      .all(user_id) as SqliteRow[];
    return rows.map((row) => this.toAuthToken(row));
  }

  /**
   * 更新 token 最后使用时间。
   */
  touchToken(tokenIdInput: string): void {
    const token_id = normalizeNonEmptyText(tokenIdInput, "token_id");
    const now = nowIso();
    this.sqlite
      .prepare("UPDATE auth_tokens SET last_used_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, token_id);
  }

  /**
   * 吊销 token。
   */
  revokeToken(tokenIdInput: string): AuthTokenRecord | null {
    const token_id = normalizeNonEmptyText(tokenIdInput, "token_id");
    const now = nowIso();
    this.sqlite
      .prepare("UPDATE auth_tokens SET revoked_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, token_id);
    return this.getTokenById(token_id);
  }

  /**
   * 删除 token。
   */
  deleteToken(tokenIdInput: string): boolean {
    const token_id = normalizeNonEmptyText(tokenIdInput, "token_id");
    const result = this.sqlite
      .prepare("DELETE FROM auth_tokens WHERE id = ?")
      .run(token_id);
    return result.changes > 0;
  }

  /**
   * 写入审计日志。
   */
  insertAuditLog(input: {
    actor_user_id?: string;
    actor_token_id?: string;
    resource_type: string;
    resource_id?: string;
    action: string;
    result: string;
    request_id?: string;
    ip?: string;
    user_agent?: string;
    meta_json?: string;
  }): AuthAuditLog {
    const id = nanoid();
    const created_at = nowIso();
    const row: AuthAuditLog = {
      id,
      actor_user_id: optionalTrimmedText(input.actor_user_id),
      actor_token_id: optionalTrimmedText(input.actor_token_id),
      resource_type: normalizeNonEmptyText(input.resource_type, "resource_type"),
      resource_id: optionalTrimmedText(input.resource_id),
      action: normalizeNonEmptyText(input.action, "action"),
      result: normalizeNonEmptyText(input.result, "result"),
      request_id: optionalTrimmedText(input.request_id),
      ip: optionalTrimmedText(input.ip),
      user_agent: optionalTrimmedText(input.user_agent),
      meta_json: optionalTrimmedText(input.meta_json),
      created_at,
    };
    this.sqlite
      .prepare(
        "INSERT INTO auth_audit_logs (id, actor_user_id, actor_token_id, resource_type, resource_id, action, result, request_id, ip, user_agent, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.id,
        row.actor_user_id || null,
        row.actor_token_id || null,
        row.resource_type,
        row.resource_id || null,
        row.action,
        row.result,
        row.request_id || null,
        row.ip || null,
        row.user_agent || null,
        row.meta_json || null,
        row.created_at,
      );
    return row;
  }

  /**
   * 将 token 记录转换为对外摘要。
   */
  toTokenSummary(record: AuthTokenRecord): AuthTokenSummary {
    return {
      id: record.id,
      name: record.name,
      expires_at: record.expires_at,
      last_used_at: record.last_used_at,
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
  }

  /**
   * 将 token 记录与明文 token 合成为一次性返回体。
   */
  toIssuedToken(record: AuthTokenRecord, token: string): AuthIssuedToken {
    return {
      ...this.toTokenSummary(record),
      token,
    };
  }

  private toAuthUser(row: SqliteRow): AuthUser {
    return {
      id: String(row.id || ""),
      username: String(row.username || ""),
      password_hash: String(row.password_hash || ""),
      display_name: optionalTrimmedText(String(row.display_name || "")),
      status: String(row.status || "active") === "disabled" ? "disabled" : "active",
      created_at: String(row.created_at || ""),
      updated_at: String(row.updated_at || ""),
    };
  }

  private toAuthToken(row: SqliteRow): AuthTokenRecord {
    return {
      id: String(row.id || ""),
      user_id: String(row.user_id || ""),
      name: String(row.name || ""),
      token_hash: String(row.token_hash || ""),
      expires_at: optionalTrimmedText(String(row.expires_at || "")),
      revoked_at: optionalTrimmedText(String(row.revoked_at || "")),
      last_used_at: optionalTrimmedText(String(row.last_used_at || "")),
      created_at: String(row.created_at || ""),
      updated_at: String(row.updated_at || ""),
    };
  }

}
