/**
 * LocalCityStore SQLite 连接与 Schema。
 *
 * 本模块只负责连接、建表和结构迁移，不创建 Agent 或解释 Plugin 业务。
 */

import fs from "fs-extra";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { get_local_database_path } from "@/store/LocalPaths.js";

/** LocalCityStore 共享的 SQLite 连接。 */
export class LocalDatabase {
  /** 原始 SQLite 连接，仅供 Store 内部仓储使用。 */
  readonly sqlite: DatabaseSync;

  constructor(root_path: string) {
    fs.ensureDirSync(root_path);
    this.sqlite = new DatabaseSync(get_local_database_path(root_path));
    this.sqlite.exec("PRAGMA busy_timeout = 5000;");
    this.sqlite.exec("PRAGMA journal_mode = WAL;");
    this.ensure_schema();
  }

  /** 关闭当前连接。 */
  close(): void {
    this.sqlite.close();
  }

  /** 初始化统一配置表并补齐 Agent 到 Workspace 的稳定外键。 */
  private ensure_schema(): void {
    this.sqlite.exec(`
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
    this.ensure_workspace_id_column();
    this.ensure_workspace_id_index();
    this.bind_single_legacy_workspace();
  }

  /** 为已由旧 Registry 创建的 Agent 表补充 workspace_id。 */
  private ensure_workspace_id_column(): void {
    const columns = this.sqlite.prepare("PRAGMA table_info(managed_agents)").all() as Array<{
      /** 列名。 */
      name?: unknown;
    }>;
    if (!columns.some((column) => String(column.name || "") === "workspace_id")) {
      this.sqlite.exec("ALTER TABLE managed_agents ADD COLUMN workspace_id TEXT;");
    }
  }

  /** 在新建或迁移 workspace_id 列之后创建查询索引。 */
  private ensure_workspace_id_index(): void {
    this.sqlite.exec(`
      CREATE INDEX IF NOT EXISTS managed_agents_workspace_id_idx
      ON managed_agents(workspace_id);
    `);
  }

  /** 只有一个 Workspace 时，为上一版已解绑的 Agent 确定性恢复关系。 */
  private bind_single_legacy_workspace(): void {
    const rows = this.sqlite.prepare(
      "SELECT workspace_id FROM workspaces ORDER BY workspace_id ASC LIMIT 2;",
    ).all() as Array<{ workspace_id: string }>;
    if (rows.length !== 1) return;
    this.sqlite.prepare(
      "UPDATE managed_agents SET workspace_id = ? WHERE workspace_id IS NULL OR workspace_id = '';",
    ).run(rows[0].workspace_id);
  }
}
