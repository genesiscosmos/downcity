/**
 * PlatformStore Schema 管理。
 *
 * 关键点（中文）
 * - 负责 `PlatformStore` 的建表与轻量迁移。
 * - 启动时执行，不承担任何查询写入业务逻辑。
 */

import type { PlatformStoreContext } from "@/city/runtime/store/StoreShared.js";
import { decryptTextSync, encryptTextSync } from "@/city/runtime/store/crypto.js";

/**
 * 初始化 PlatformStore 所需表结构。
 */
export function ensurePlatformStoreSchema(context: PlatformStoreContext): void {
  dropLegacyAuthSchema(context);
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
  ensureAgentTokenSchema(context);
  ensurePluginSchema(context);
  migrate_chat_plugin_config(context);
}

/**
 * 删除旧的 User/Role/Permission/RBAC 表。
 *
 * 关键点（中文）：City Token 已收敛为单 Agent Token，旧账户模型不再参与迁移或兼容。
 */
function dropLegacyAuthSchema(context: PlatformStoreContext): void {
  const legacy_table = context.sqlite.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN (
      'auth_users', 'auth_roles', 'auth_permissions', 'auth_user_roles',
      'auth_role_permissions', 'auth_tokens', 'auth_audit_logs'
    )
    LIMIT 1;
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

/**
 * 初始化单 Agent Bearer Token 表结构。
 *
 * 关键点（中文）
 * - Token 只绑定一个 Agent，不引入用户、角色或权限目录。
 * - 明文 Token 永不落库，只保存 SHA-256 哈希。
 */
function ensureAgentTokenSchema(context: PlatformStoreContext): void {
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
  `);
  context.sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS agent_tokens_token_hash_uq
    ON agent_tokens(token_hash);
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS agent_tokens_agent_id_idx
    ON agent_tokens(agent_id);
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS agent_tokens_expires_at_idx
    ON agent_tokens(expires_at);
  `);
}

/**
 * 初始化 Plugin 安装目录与 Agent 绑定表。
 *
 * 关键点（中文）
 * - installed_plugins 只描述全局已安装制品。
 * - agent_plugins 保存 Agent 与 Plugin 的启用关系及结构化配置。
 */
function ensurePluginSchema(context: PlatformStoreContext): void {
  context.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS installed_plugins (
      plugin_name TEXT PRIMARY KEY NOT NULL,
      source TEXT NOT NULL,
      resolved_commit TEXT,
      version TEXT NOT NULL,
      entry_path TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      integrity TEXT,
      installed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS installed_plugins_updated_at_idx
    ON installed_plugins(updated_at);
  `);
  ensure_installed_plugin_columns(context);

  context.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_plugins (
      agent_id TEXT NOT NULL,
      plugin_name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      config_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (agent_id, plugin_name)
    );
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS agent_plugins_agent_id_idx
    ON agent_plugins(agent_id);
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS agent_plugins_plugin_name_idx
    ON agent_plugins(plugin_name);
  `);
}

/** 补齐 installed_plugins 表的增量制品来源字段。 */
function ensure_installed_plugin_columns(context: PlatformStoreContext): void {
  const rows = context.sqlite
    .prepare("PRAGMA table_info(installed_plugins)")
    .all() as Array<{ name?: unknown }>;
  const columns = new Set(
    rows.map((row) => String(row.name || "").trim()).filter(Boolean),
  );
  if (!columns.has("resolved_commit")) {
    context.sqlite.exec("ALTER TABLE installed_plugins ADD COLUMN resolved_commit TEXT;");
  }
}

/**
 * 把旧 Chat Binding 配置一次性迁移为 snake_case canonical 数据。
 *
 * 关键点（中文）
 * - 迁移完成后运行时只理解新协议，不保留双字段读取分支。
 * - 事务内逐行解密、转换并重新加密，避免部分 Agent 留在旧状态。
 */
function migrate_chat_plugin_config(context: PlatformStoreContext): void {
  const rows = context.sqlite.prepare(`
    SELECT agent_id, config_encrypted
    FROM agent_plugins
    WHERE plugin_name = 'chat';
  `).all() as Array<{ agent_id: string; config_encrypted: string }>;
  const updates: Array<{ agent_id: string; config_encrypted: string }> = [];

  for (const row of rows) {
    const config = JSON.parse(decryptTextSync(row.config_encrypted)) as Record<string, unknown>;
    let changed = false;
    const queue = as_record(config.queue);
    if (queue) {
      changed = move_record_field(queue, "maxConcurrency", "max_concurrency") || changed;
      changed = move_record_field(queue, "mergeDebounceMs", "merge_debounce_ms") || changed;
      changed = move_record_field(queue, "mergeMaxWaitMs", "merge_max_wait_ms") || changed;
    }
    const channels = as_record(config.channels);
    if (channels) {
      for (const value of Object.values(channels)) {
        const channel = as_record(value);
        if (channel) {
          changed = move_record_field(channel, "channelAccountId", "channel_account_id") || changed;
        }
      }
    }
    if (changed) {
      updates.push({
        agent_id: row.agent_id,
        config_encrypted: encryptTextSync(JSON.stringify(config)),
      });
    }
  }

  const commit = context.sqlite.transaction(() => {
    const update = context.sqlite.prepare(`
      UPDATE agent_plugins
      SET config_encrypted = ?, updated_at = ?
      WHERE agent_id = ? AND plugin_name = 'chat';
    `);
    const current_time = new Date().toISOString();
    for (const item of updates) update.run(item.config_encrypted, current_time, item.agent_id);
  });
  commit();
}

/** 把旧字段移动为新字段，已有新字段始终优先。 */
function move_record_field(
  record: Record<string, unknown>,
  old_key: string,
  new_key: string,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(record, old_key)) return false;
  if (!Object.prototype.hasOwnProperty.call(record, new_key)) record[new_key] = record[old_key];
  delete record[old_key];
  return true;
}

/** 把未知值收窄为普通 record。 */
function as_record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
