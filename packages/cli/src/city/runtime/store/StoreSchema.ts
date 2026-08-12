/**
 * CLI 专属 PlatformStore Schema 管理。
 *
 * Agent、Workspace、Plugin 与 Resource 表全部由 `@downcity/city` 初始化；本模块只
 * 维护 CLI HTTP/RPC 宿主需要的 Token 表和历史鉴权表清理。
 */

import type { PlatformStoreContext } from "@/city/runtime/store/StoreShared.js";

/** 初始化 CLI 专属持久化结构。 */
export function ensurePlatformStoreSchema(context: PlatformStoreContext): void {
  drop_legacy_auth_schema(context);
  context.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS platform_secure_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  ensure_agent_token_schema(context);
}

/** 删除已经停止使用的 User、Role、Permission 与 RBAC 表。 */
function drop_legacy_auth_schema(context: PlatformStoreContext): void {
  const legacy_table = context.sqlite.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN (
      'auth_users', 'auth_roles', 'auth_permissions', 'auth_user_roles',
      'auth_role_permissions', 'auth_tokens', 'auth_audit_logs'
    ) LIMIT 1;
  `).get() as { name?: string } | undefined;
  if (!legacy_table) return;
  context.sqlite.exec(`
    DROP TABLE IF EXISTS auth_role_permissions;
    DROP TABLE IF EXISTS auth_user_roles;
    DROP TABLE IF EXISTS auth_audit_logs;
    DROP TABLE IF EXISTS auth_tokens;
    DROP TABLE IF EXISTS auth_permissions;
    DROP TABLE IF EXISTS auth_roles;
    DROP TABLE IF EXISTS auth_users;
  `);
}

/** 初始化绑定单个 Agent 的 Bearer Token 表。 */
function ensure_agent_token_schema(context: PlatformStoreContext): void {
  context.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_tokens (
      id TEXT PRIMARY KEY NOT NULL,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS agent_tokens_token_hash_uq
    ON agent_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS agent_tokens_agent_id_idx
    ON agent_tokens(agent_id);
    CREATE INDEX IF NOT EXISTS agent_tokens_expires_at_idx
    ON agent_tokens(expires_at);
  `);
}
