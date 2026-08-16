/**
 * Downcity 本地产品 Schema。
 *
 * Schema 属于本地产品数据模型，不属于数据库 Adapter。这里仅按当前版本建表，
 * 不识别或迁移历史结构。
 */
import type { LocalDatabase } from "@/database/LocalDatabase.js";

/** 初始化当前版本的本地产品表。 */
export function ensure_local_schema(database: LocalDatabase): void {
    database.execute_script(`
      CREATE TABLE IF NOT EXISTS workspaces (
        workspace_id TEXT PRIMARY KEY NOT NULL,
        workspace_path TEXT UNIQUE NOT NULL,
        config_encrypted TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS workspaces_updated_at_idx
      ON workspaces(updated_at);

      CREATE TABLE IF NOT EXISTS plugin_resources (
        plugin_name TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        item_encrypted TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (plugin_name, resource_id)
      );

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

      CREATE TABLE IF NOT EXISTS platform_secure_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value_encrypted TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }
