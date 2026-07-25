/**
 * PlatformStore Schema 管理。
 *
 * 关键点（中文）
 * - 负责 `PlatformStore` 的建表与轻量迁移。
 * - 启动时执行，不承担任何查询写入业务逻辑。
 */

import type { PlatformStoreContext } from "@/city/runtime/store/StoreShared.js";

/**
 * 初始化 PlatformStore 所需表结构。
 */
export function ensurePlatformStoreSchema(context: PlatformStoreContext): void {
  context.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS platform_secure_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  context.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS env_entries (
      scope TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT '',
      key TEXT NOT NULL,
      description TEXT,
      value_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope, agent_id, key)
    );
  `);
  context.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS managed_agents (
      agent_id TEXT PRIMARY KEY NOT NULL,
      workspace_path TEXT NOT NULL,
      config_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS managed_agents_workspace_path_idx
    ON managed_agents(workspace_path);
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS managed_agents_updated_at_idx
    ON managed_agents(updated_at);
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS env_entries_scope_idx
    ON env_entries(scope);
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS env_entries_agent_id_idx
    ON env_entries(agent_id);
  `);
  ensureEnvEntriesColumns(context);
  context.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS channel_accounts (
      id TEXT PRIMARY KEY NOT NULL,
      channel TEXT NOT NULL,
      name TEXT NOT NULL,
      identity TEXT,
      owner TEXT,
      creator TEXT,
      bot_token_encrypted TEXT,
      app_id_encrypted TEXT,
      app_secret_encrypted TEXT,
      domain TEXT,
      sandbox INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS channel_accounts_channel_idx
    ON channel_accounts(channel);
  `);
  ensureChannelAccountsTableColumns(context);
  ensureAuthSchema(context);
}

/**
 * 初始化平台认证与授权表结构。
 *
 * 关键点（中文）
 * - 该 schema 属于平台级全局能力，不依赖任何单个 agent 项目。
 * - V1 只建表与索引，不在这里写入默认数据，默认数据由 auth bootstrap 负责。
 */
function ensureAuthSchema(context: PlatformStoreContext): void {
  context.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY NOT NULL,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  context.sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS auth_users_username_uq
    ON auth_users(username);
  `);

  context.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS auth_roles (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  context.sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS auth_roles_name_uq
    ON auth_roles(name);
  `);

  context.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS auth_permissions (
      id TEXT PRIMARY KEY NOT NULL,
      key TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  context.sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS auth_permissions_key_uq
    ON auth_permissions(key);
  `);

  context.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS auth_user_roles (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  context.sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS auth_user_roles_user_role_uq
    ON auth_user_roles(user_id, role_id);
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS auth_user_roles_user_id_idx
    ON auth_user_roles(user_id);
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS auth_user_roles_role_id_idx
    ON auth_user_roles(role_id);
  `);

  context.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS auth_role_permissions (
      id TEXT PRIMARY KEY NOT NULL,
      role_id TEXT NOT NULL,
      permission_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  context.sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS auth_role_permissions_role_permission_uq
    ON auth_role_permissions(role_id, permission_id);
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS auth_role_permissions_role_id_idx
    ON auth_role_permissions(role_id);
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS auth_role_permissions_permission_id_idx
    ON auth_role_permissions(permission_id);
  `);

  context.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  context.sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS auth_tokens_token_hash_uq
    ON auth_tokens(token_hash);
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS auth_tokens_user_id_idx
    ON auth_tokens(user_id);
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS auth_tokens_expires_at_idx
    ON auth_tokens(expires_at);
  `);

  context.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS auth_audit_logs (
      id TEXT PRIMARY KEY NOT NULL,
      actor_user_id TEXT,
      actor_token_id TEXT,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      action TEXT NOT NULL,
      result TEXT NOT NULL,
      request_id TEXT,
      ip TEXT,
      user_agent TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS auth_audit_logs_actor_created_idx
    ON auth_audit_logs(actor_user_id, created_at);
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS auth_audit_logs_action_created_idx
    ON auth_audit_logs(action, created_at);
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS auth_audit_logs_resource_idx
    ON auth_audit_logs(resource_type, resource_id);
  `);
}

/**
 * 补齐 channel_accounts 表的增量列。
 */
function ensureChannelAccountsTableColumns(context: PlatformStoreContext): void {
  const rows = context.sqlite
    .prepare("PRAGMA table_info(channel_accounts)")
    .all() as Array<{ name?: unknown }>;
  const columns = new Set(
    rows.map((row) => String(row.name || "").trim()).filter(Boolean),
  );
  if (!columns.has("owner")) {
    context.sqlite.exec("ALTER TABLE channel_accounts ADD COLUMN owner TEXT;");
  }
  if (!columns.has("creator")) {
    context.sqlite.exec("ALTER TABLE channel_accounts ADD COLUMN creator TEXT;");
  }
}

/**
 * 补齐 env_entries 表的增量列。
 */
function ensureEnvEntriesColumns(context: PlatformStoreContext): void {
  const envEntryColumns = context.sqlite
    .prepare("PRAGMA table_info(env_entries)")
    .all() as Array<{ name?: unknown }>;
  const envEntryColumnNames = new Set(
    envEntryColumns.map((row) => String(row.name || "").trim()).filter(Boolean),
  );
  if (!envEntryColumnNames.has("description")) {
    context.sqlite.exec("ALTER TABLE env_entries ADD COLUMN description TEXT;");
  }
}
