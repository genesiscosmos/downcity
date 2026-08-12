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
  // Agent 与 Workspace schema 由 @downcity/agent-registry 唯一维护。
  ensureAgentTokenSchema(context);
  ensurePluginSchema(context);
  migrate_chat_plugin_resources(context);
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
 * - plugin_installations 只描述多个 Plugin 共享的来源、入口和文件生命周期。
 * - agent_plugins 保存 Agent 与 Plugin 的启用关系及结构化配置。
 */
function ensurePluginSchema(context: PlatformStoreContext): void {
  context.sqlite.exec(`
    DROP TABLE IF EXISTS installed_plugins;
    DROP TABLE IF EXISTS installed_plugin_projects;
    CREATE TABLE IF NOT EXISTS plugin_installations (
      installation_id TEXT PRIMARY KEY NOT NULL,
      source TEXT NOT NULL,
      resolved_commit TEXT,
      entry_path TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      integrity TEXT,
      installed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS plugin_installations_updated_at_idx
    ON plugin_installations(updated_at);
  `);

  context.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_plugins (
      agent_id TEXT NOT NULL,
      plugin_name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      config_encrypted TEXT NOT NULL,
      resource_ids_json TEXT NOT NULL DEFAULT '[]',
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
  ensure_agent_plugin_columns(context);

  context.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS plugin_resources (
      plugin_name TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      item_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (plugin_name, resource_id)
    );
  `);
  context.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS plugin_resources_plugin_name_idx
    ON plugin_resources(plugin_name);
  `);
}

/** 补齐 Agent Plugin Binding 的 Resource ID 列。 */
function ensure_agent_plugin_columns(context: PlatformStoreContext): void {
  const rows = context.sqlite
    .prepare("PRAGMA table_info(agent_plugins)")
    .all() as Array<{ name?: unknown }>;
  const columns = new Set(
    rows.map((row) => String(row.name || "").trim()).filter(Boolean),
  );
  if (!columns.has("resource_ids_json")) {
    context.sqlite.exec(
      "ALTER TABLE agent_plugins ADD COLUMN resource_ids_json TEXT NOT NULL DEFAULT '[]';",
    );
  }
}

/**
 * 把旧 Chat Account 与 Binding 一次性迁移为 Plugin Resource。
 *
 * 关键点（中文）
 * - 迁移完成后运行时只理解新协议，不保留双字段读取分支。
 * - 事务内逐行解密、转换并重新加密，避免部分 Agent 留在旧状态。
 */
function migrate_chat_plugin_resources(context: PlatformStoreContext): void {
  const legacy_table = context.sqlite.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'channel_accounts'
    LIMIT 1;
  `).get() as { name?: string } | undefined;
  if (!legacy_table) return;

  const migrate = (): void => {
    migrate_channel_accounts_to_plugin_resources(context);
    const rows = context.sqlite.prepare(`
      SELECT agent_id, config_encrypted, resource_ids_json
      FROM agent_plugins
      WHERE plugin_name = 'chat';
    `).all() as Array<{
      agent_id: string;
      config_encrypted: string;
      resource_ids_json: string;
    }>;
    const update = context.sqlite.prepare(`
      UPDATE agent_plugins
      SET config_encrypted = ?, resource_ids_json = ?, updated_at = ?
      WHERE agent_id = ? AND plugin_name = 'chat';
    `);
    const current_time = new Date().toISOString();

    for (const row of rows) {
      const config = JSON.parse(decryptTextSync(row.config_encrypted)) as Record<string, unknown>;
      let changed = false;
      const queue = as_record(config.queue);
      if (queue) {
        changed = move_record_field(queue, "maxConcurrency", "max_concurrency") || changed;
        changed = move_record_field(queue, "mergeDebounceMs", "merge_debounce_ms") || changed;
        changed = move_record_field(queue, "mergeMaxWaitMs", "merge_max_wait_ms") || changed;
      }
      const resource_ids = parse_resource_ids(row.resource_ids_json);
      const channels = as_record(config.channels);
      if (channels) {
        for (const value of Object.values(channels)) {
          const channel = as_record(value);
          if (!channel) continue;
          changed = move_record_field(channel, "channelAccountId", "channel_account_id") || changed;
          const resource_id = String(channel.channel_account_id || "").trim();
          const resource_exists = resource_id
            ? Boolean(context.sqlite.prepare(`
                SELECT resource_id FROM plugin_resources
                WHERE plugin_name = 'chat' AND resource_id = ?
                LIMIT 1;
              `).get(resource_id))
            : false;
          if (
            channel.enabled === true
            && resource_exists
            && !resource_ids.includes(resource_id)
          ) {
            resource_ids.push(resource_id);
          }
        }
        delete config.channels;
        changed = true;
      }
      if (!changed) continue;
      update.run(
        encryptTextSync(JSON.stringify(config)),
        JSON.stringify(resource_ids),
        current_time,
        row.agent_id,
      );
    }
    context.sqlite.exec("DROP TABLE channel_accounts;");
  };
  context.sqlite.exec("BEGIN IMMEDIATE;");
  try {
    migrate();
    context.sqlite.exec("COMMIT;");
  } catch (error) {
    context.sqlite.exec("ROLLBACK;");
    throw error;
  }
}

/** 把旧 Chat Account 行转换为完整 Chat Plugin Resource Item。 */
function migrate_channel_accounts_to_plugin_resources(
  context: PlatformStoreContext,
): void {
  const rows = context.sqlite.prepare("SELECT * FROM channel_accounts;").all() as Array<
    Record<string, unknown>
  >;
  const insert = context.sqlite.prepare(`
    INSERT OR IGNORE INTO plugin_resources (
      plugin_name, resource_id, item_encrypted, created_at, updated_at
    ) VALUES ('chat', ?, ?, ?, ?);
  `);
  for (const row of rows) {
    const id = String(row.id || "").trim();
    const type = String(row.channel || "").trim();
    if (!id || (type !== "telegram" && type !== "feishu" && type !== "qq")) continue;
    const item: Record<string, unknown> = {
      id,
      type,
      name: String(row.name || "").trim() || id,
    };
    const bot_token = decrypt_optional_column(row.bot_token_encrypted);
    const app_id = decrypt_optional_column(row.app_id_encrypted);
    const app_secret = decrypt_optional_column(row.app_secret_encrypted);
    const identity = String(row.identity || "").trim();
    const owner = String(row.owner || "").trim();
    const creator = String(row.creator || "").trim();
    const domain = String(row.domain || "").trim();
    if (bot_token) item.bot_token = bot_token;
    if (app_id) item.app_id = app_id;
    if (app_secret) item.app_secret = app_secret;
    if (type === "telegram" && identity) item.username = identity;
    if (type !== "telegram" && identity) item.identity = identity;
    if (type === "feishu" && owner) item.owner = owner;
    if (type === "feishu" && creator) item.creator = creator;
    if (type === "feishu" && domain) item.domain = domain;
    if (type === "qq" && Number(row.sandbox || 0) === 1) item.sandbox = true;
    const configured = type === "telegram"
      ? Boolean(bot_token)
      : Boolean(app_id && app_secret);
    if (!configured) continue;
    const created_at = String(row.created_at || "").trim() || new Date().toISOString();
    const updated_at = String(row.updated_at || "").trim() || created_at;
    insert.run(id, encryptTextSync(JSON.stringify(item)), created_at, updated_at);
  }
}

/** 解密旧表中的可选凭据列。 */
function decrypt_optional_column(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const decrypted = decryptTextSync(value).trim();
  return decrypted || undefined;
}

/** 解析 Binding 的 Resource ID 数组并过滤非法值。 */
function parse_resource_ids(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((item) => String(item || "").trim()).filter(Boolean))];
  } catch {
    return [];
  }
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
