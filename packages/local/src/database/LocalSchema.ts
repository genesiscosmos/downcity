/**
 * Downcity 本地产品 Schema。
 *
 * Schema 属于本地产品数据模型，不属于数据库 Adapter。这里负责建表和结构迁移，
 * 通过 LocalDatabase 的 SQL 原语工作。
 */
import type { LocalDatabase } from "@/database/LocalDatabase.js";

/** 初始化本地产品表并执行幂等结构迁移。 */
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

      CREATE TABLE IF NOT EXISTS managed_agents (
        agent_id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT,
        config_encrypted TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id)
      );
      CREATE INDEX IF NOT EXISTS managed_agents_updated_at_idx
      ON managed_agents(updated_at);

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
    database.execute_script(`
      CREATE INDEX IF NOT EXISTS managed_agents_workspace_id_idx
      ON managed_agents(workspace_id);
    `);
  }
