/**
 * Downcity Agent 与 Workspace Registry 共享仓储。
 *
 * 该模块是 CLI 与 Desktop 的唯一注册事实源。Agent 与 Workspace 分表保存，
 * 只负责用户级 SQLite 持久化，不负责 Agent、Session 或进程生命周期。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AgentRegistryRecord,
  CreateAgentRegistryInput,
  CreateWorkspaceRegistryInput,
  UpdateAgentRegistryInput,
  UpdateWorkspaceRegistryInput,
  WorkspaceRegistryRecord,
} from "./types/AgentRegistry.js";

export type {
  AgentRegistryRecord,
  CreateAgentRegistryInput,
  CreateWorkspaceRegistryInput,
  UpdateAgentRegistryInput,
  UpdateWorkspaceRegistryInput,
  WorkspaceRegistryRecord,
} from "./types/AgentRegistry.js";

/** 获取 Downcity 用户级根目录。 */
export function get_agent_registry_root_path(): string {
  const explicit_root = String(process.env.DC_PLATFORM_ROOT || "").trim();
  return explicit_root ? path.resolve(explicit_root) : path.join(os.homedir(), ".downcity");
}

/** 获取 CLI 与 Desktop 共用的 SQLite 路径。 */
export function get_agent_registry_db_path(): string {
  return path.join(get_agent_registry_root_path(), "downcity.db");
}

/** 规范化全局 Agent ID。 */
export function normalize_agent_registry_id(input: string): string {
  const agent_id = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  if (!agent_id) throw new Error("agent_id is required");
  return agent_id;
}

/** 规范化 Workspace ID。 */
export function normalize_workspace_registry_id(input: string): string {
  const workspace_id = String(input || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(workspace_id)) {
    throw new Error(`Invalid workspace_id: ${input}`);
  }
  return workspace_id;
}

/** 规范化 Workspace 绝对路径。 */
export function normalize_agent_registry_workspace(input: string): string {
  const raw_path = String(input || "").trim();
  if (!raw_path) throw new Error("workspace_path is required");
  return path.resolve(raw_path);
}

/** 读取 Registry 加密密钥。 */
function get_key(): Buffer {
  const env_key = String(process.env.DC_MODEL_DB_KEY || "").trim();
  if (env_key) return crypto.createHash("sha256").update(env_key, "utf8").digest();
  const key_path = path.join(get_agent_registry_root_path(), "main", "model-db.key");
  fs.mkdirSync(path.dirname(key_path), { recursive: true });
  if (fs.existsSync(key_path)) {
    const key = Buffer.from(String(fs.readFileSync(key_path, "utf8")).trim(), "base64");
    if (key.length === 32) return key;
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(key_path, key.toString("base64"), { mode: 0o600 });
  return key;
}

/** 加密一条 Registry JSON 记录。 */
function encode_record(record: AgentRegistryRecord | WorkspaceRegistryRecord): string {
  const key = get_key();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(record), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

/** 解密一条 Registry JSON 记录。 */
function decode_record<T>(value: unknown): T | null {
  if (typeof value !== "string" || !value) return null;
  const packed = Buffer.from(value, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", get_key(), packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8"),
  ) as T;
}

/** 把解密数据收敛为 Agent Registry 唯一允许的字段集合。 */
function normalize_agent_record(
  value: AgentRegistryRecord,
  created_at_fallback?: string,
  updated_at_fallback?: string,
): AgentRegistryRecord {
  const agent_id = normalize_agent_registry_id(value.agent_id);
  return {
    agent_id,
    version: String(value.version || "1.0.0"),
    ...(value.start !== undefined ? { start: value.start } : {}),
    ...(value.execution !== undefined ? { execution: value.execution } : {}),
    ...(value.llm !== undefined ? { llm: value.llm } : {}),
    created_at: String(value.created_at || created_at_fallback || ""),
    updated_at: String(value.updated_at || updated_at_fallback || ""),
  };
}

/** 把解密数据收敛为 Workspace Registry 唯一允许的字段集合。 */
function normalize_workspace_record(value: WorkspaceRegistryRecord): WorkspaceRegistryRecord {
  const workspace_path = normalize_agent_registry_workspace(value.workspace_path);
  return {
    workspace_id: normalize_workspace_registry_id(value.workspace_id),
    workspace_path,
    name: normalize_workspace_name(value.name, workspace_path),
    created_at: String(value.created_at || ""),
    updated_at: String(value.updated_at || ""),
  };
}

/** 在独立连接中执行一次 Registry 操作。 */
function with_database<T>(callback: (database: DatabaseSync) => T): T {
  const db_path = get_agent_registry_db_path();
  fs.mkdirSync(path.dirname(db_path), { recursive: true });
  const database = new DatabaseSync(db_path);
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec("PRAGMA journal_mode = WAL;");
  ensure_registry_schema(database);
  try {
    return callback(database);
  } finally {
    database.close();
  }
}

/** 初始化 Agent 与 Workspace 表，并迁移旧的强绑定结构。 */
function ensure_registry_schema(database: DatabaseSync): void {
  const managed_agents_exists = Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'managed_agents' LIMIT 1;",
  ).get());
  if (managed_agents_exists && table_has_column(database, "managed_agents", "workspace_path")) {
    migrate_legacy_agent_workspace_bindings(database);
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS managed_agents (
      agent_id TEXT PRIMARY KEY NOT NULL,
      config_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS managed_agents_updated_at_idx
    ON managed_agents(updated_at);

    CREATE TABLE IF NOT EXISTS workspaces (
      workspace_id TEXT PRIMARY KEY NOT NULL,
      workspace_path TEXT UNIQUE NOT NULL,
      config_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workspaces_updated_at_idx
    ON workspaces(updated_at);
  `);
}

/** 判断表是否存在指定列。 */
function table_has_column(database: DatabaseSync, table_name: string, column_name: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${table_name})`).all() as Array<{ name?: unknown }>;
  return rows.some((row) => String(row.name || "") === column_name);
}

/**
 * 把旧 Agent 记录中的 Workspace 路径提取为独立记录。
 *
 * 迁移在单个 IMMEDIATE 事务内完成。Agent 的身份、模型、Plugin 关联与时间戳保持不变，
 * Session 仍留在原 Workspace，因此无需移动任何项目文件。
 */
function migrate_legacy_agent_workspace_bindings(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE;");
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        workspace_id TEXT PRIMARY KEY NOT NULL,
        workspace_path TEXT UNIQUE NOT NULL,
        config_encrypted TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE managed_agents_next (
        agent_id TEXT PRIMARY KEY NOT NULL,
        config_encrypted TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const rows = database.prepare(`
      SELECT agent_id, workspace_path, config_encrypted, created_at, updated_at
      FROM managed_agents
      ORDER BY agent_id ASC;
    `).all() as Array<{
      agent_id: string;
      workspace_path: string;
      config_encrypted: string;
      created_at: string;
      updated_at: string;
    }>;
    for (const row of rows) {
      const legacy_record = decode_record<AgentRegistryRecord & { workspace_path?: unknown }>(row.config_encrypted);
      if (!legacy_record) throw new Error(`Cannot decode Agent registry record: ${row.agent_id}`);
      const workspace_path = normalize_agent_registry_workspace(
        String(legacy_record.workspace_path || row.workspace_path || ""),
      );
      ensure_migrated_workspace(database, workspace_path, row.created_at, row.updated_at);
      const agent_record = normalize_agent_record(
        legacy_record,
        row.created_at,
        row.updated_at,
      );
      database.prepare(`
        INSERT INTO managed_agents_next (
          agent_id, config_encrypted, created_at, updated_at
        ) VALUES (?, ?, ?, ?);
      `).run(
        row.agent_id,
        encode_record(agent_record),
        row.created_at,
        row.updated_at,
      );
    }
    database.exec(`
      DROP INDEX IF EXISTS managed_agents_workspace_path_idx;
      DROP INDEX IF EXISTS managed_agents_updated_at_idx;
      DROP TABLE managed_agents;
      ALTER TABLE managed_agents_next RENAME TO managed_agents;
      CREATE INDEX managed_agents_updated_at_idx ON managed_agents(updated_at);
      CREATE INDEX IF NOT EXISTS workspaces_updated_at_idx ON workspaces(updated_at);
      COMMIT;
    `);
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

/** 为旧 Agent 路径创建唯一 Workspace 记录。 */
function ensure_migrated_workspace(
  database: DatabaseSync,
  workspace_path: string,
  created_at: string,
  updated_at: string,
): void {
  if (database.prepare(
    "SELECT 1 FROM workspaces WHERE workspace_path = ? LIMIT 1;",
  ).get(workspace_path)) return;
  const workspace_id = `workspace_${crypto.randomUUID().replace(/-/g, "")}`;
  const record: WorkspaceRegistryRecord = {
    workspace_id,
    workspace_path,
    name: path.basename(workspace_path) || workspace_id,
    created_at,
    updated_at,
  };
  database.prepare(`
    INSERT INTO workspaces (
      workspace_id, workspace_path, config_encrypted, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?);
  `).run(workspace_id, workspace_path, encode_record(record), created_at, updated_at);
}

/** 列出全部已注册 Agent。 */
export function list_agent_registry_records(): AgentRegistryRecord[] {
  return with_database((database) => (
    database.prepare(
      "SELECT config_encrypted FROM managed_agents ORDER BY agent_id ASC;",
    ).all() as Array<{ config_encrypted: string }>
  ).map((row) => decode_record<AgentRegistryRecord>(row.config_encrypted))
    .filter((record): record is AgentRegistryRecord => record !== null)
    .map((record) => normalize_agent_record(record)));
}

/** 创建并持久化 Agent 注册记录。 */
export function create_agent_registry_record(input: CreateAgentRegistryInput): AgentRegistryRecord {
  const agent_id = normalize_agent_registry_id(input.agent_id);
  return with_database((database) => {
    if (database.prepare(
      "SELECT 1 FROM managed_agents WHERE agent_id = ? LIMIT 1;",
    ).get(agent_id)) throw new Error(`Agent already exists: ${agent_id}`);
    const current_time = new Date().toISOString();
    const record: AgentRegistryRecord = {
      agent_id,
      version: String(input.version || "1.0.0"),
      ...(input.start !== undefined ? { start: input.start } : {}),
      ...(input.execution !== undefined ? { execution: input.execution } : {}),
      ...(input.llm !== undefined ? { llm: input.llm } : {}),
      created_at: current_time,
      updated_at: current_time,
    };
    database.prepare(`
      INSERT INTO managed_agents (
        agent_id, config_encrypted, created_at, updated_at
      ) VALUES (?, ?, ?, ?);
    `).run(agent_id, encode_record(record), current_time, current_time);
    return record;
  });
}

/** 按 ID 读取 Agent。 */
export function get_agent_registry_record(agent_id_input: string): AgentRegistryRecord | null {
  const agent_id = normalize_agent_registry_id(agent_id_input);
  return with_database((database) => {
    const record = decode_record<AgentRegistryRecord>((database.prepare(
      "SELECT config_encrypted FROM managed_agents WHERE agent_id = ? LIMIT 1;",
    ).get(agent_id) as { config_encrypted?: string } | undefined)?.config_encrypted);
    return record ? normalize_agent_record(record) : null;
  });
}

/** 更新现有 Agent 注册记录。 */
export function update_agent_registry_record(input: UpdateAgentRegistryInput): AgentRegistryRecord {
  const existing = get_agent_registry_record(input.agent_id);
  if (!existing) throw new Error(`Agent not found: ${input.agent_id}`);
  return save_agent_registry_record({
    ...existing,
    ...(Object.prototype.hasOwnProperty.call(input, "start") ? { start: input.start } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "execution") ? { execution: input.execution } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "llm") ? { llm: input.llm } : {}),
    updated_at: new Date().toISOString(),
  });
}

/** 保存完整 Agent 注册记录，并保留原创建时间。 */
export function save_agent_registry_record(input: AgentRegistryRecord): AgentRegistryRecord {
  const agent_id = normalize_agent_registry_id(input.agent_id);
  return with_database((database) => {
    const previous_raw = decode_record<AgentRegistryRecord>((database.prepare(
      "SELECT config_encrypted FROM managed_agents WHERE agent_id = ? LIMIT 1;",
    ).get(agent_id) as { config_encrypted?: string } | undefined)?.config_encrypted);
    if (!previous_raw) throw new Error(`Agent not found: ${agent_id}`);
    const previous = normalize_agent_record(previous_raw);
    const record: AgentRegistryRecord = {
      agent_id,
      version: String(input.version || "1.0.0"),
      ...(input.start !== undefined ? { start: input.start } : {}),
      ...(input.execution !== undefined ? { execution: input.execution } : {}),
      ...(input.llm !== undefined ? { llm: input.llm } : {}),
      created_at: previous.created_at,
      updated_at: new Date().toISOString(),
    };
    database.prepare(`
      UPDATE managed_agents
      SET config_encrypted = ?, updated_at = ?
      WHERE agent_id = ?;
    `).run(encode_record(record), record.updated_at, agent_id);
    return record;
  });
}

/** 删除 Agent 注册记录及其 Agent 级关联数据。 */
export function remove_agent_registry_record(agent_id_input: string): void {
  const agent_id = normalize_agent_registry_id(agent_id_input);
  with_database((database) => {
    database.exec("BEGIN IMMEDIATE;");
    try {
      for (const table_name of ["agent_tokens", "agent_plugins"]) {
        const exists = database.prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1;",
        ).get(table_name);
        if (exists) database.prepare(`DELETE FROM ${table_name} WHERE agent_id = ?;`).run(agent_id);
      }
      database.prepare("DELETE FROM managed_agents WHERE agent_id = ?;").run(agent_id);
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  });
}

/** 列出全部已注册 Workspace。 */
export function list_workspace_registry_records(): WorkspaceRegistryRecord[] {
  return with_database((database) => {
    const records = (
      database.prepare(
        "SELECT config_encrypted FROM workspaces ORDER BY workspace_id ASC;",
      ).all() as Array<{ config_encrypted: string }>
    ).map((row) => decode_record<WorkspaceRegistryRecord>(row.config_encrypted))
      .filter((record): record is WorkspaceRegistryRecord => record !== null)
      .map((record) => normalize_workspace_record(record));
    return records.sort((left, right) =>
      left.name.localeCompare(right.name) || left.workspace_id.localeCompare(right.workspace_id),
    );
  });
}

/** 创建 Workspace；同一路径已存在时返回已有记录。 */
export function create_workspace_registry_record(
  input: CreateWorkspaceRegistryInput,
): WorkspaceRegistryRecord {
  const workspace_path = normalize_agent_registry_workspace(input.workspace_path);
  return with_database((database) => {
    const existing = read_workspace_by_path(database, workspace_path);
    if (existing) return existing;
    const workspace_id = input.workspace_id
      ? normalize_workspace_registry_id(input.workspace_id)
      : `workspace_${crypto.randomUUID().replace(/-/g, "")}`;
    if (database.prepare(
      "SELECT 1 FROM workspaces WHERE workspace_id = ? LIMIT 1;",
    ).get(workspace_id)) throw new Error(`Workspace already exists: ${workspace_id}`);
    const current_time = new Date().toISOString();
    const record: WorkspaceRegistryRecord = {
      workspace_id,
      workspace_path,
      name: normalize_workspace_name(input.name, workspace_path),
      created_at: current_time,
      updated_at: current_time,
    };
    database.prepare(`
      INSERT INTO workspaces (
        workspace_id, workspace_path, config_encrypted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?);
    `).run(workspace_id, workspace_path, encode_record(record), current_time, current_time);
    return record;
  });
}

/** 按稳定 ID 读取 Workspace。 */
export function get_workspace_registry_record(workspace_id_input: string): WorkspaceRegistryRecord | null {
  const workspace_id = normalize_workspace_registry_id(workspace_id_input);
  return with_database((database) => {
    const record = decode_record<WorkspaceRegistryRecord>((database.prepare(
      "SELECT config_encrypted FROM workspaces WHERE workspace_id = ? LIMIT 1;",
    ).get(workspace_id) as { config_encrypted?: string } | undefined)?.config_encrypted);
    return record ? normalize_workspace_record(record) : null;
  });
}

/** 按规范化路径读取 Workspace。 */
export function get_workspace_registry_record_by_path(
  workspace_path_input: string,
): WorkspaceRegistryRecord | null {
  const workspace_path = normalize_agent_registry_workspace(workspace_path_input);
  return with_database((database) => read_workspace_by_path(database, workspace_path));
}

/** 更新 Workspace 名称或路径。 */
export function update_workspace_registry_record(
  input: UpdateWorkspaceRegistryInput,
): WorkspaceRegistryRecord {
  const workspace_id = normalize_workspace_registry_id(input.workspace_id);
  return with_database((database) => {
    const existing_raw = decode_record<WorkspaceRegistryRecord>((database.prepare(
      "SELECT config_encrypted FROM workspaces WHERE workspace_id = ? LIMIT 1;",
    ).get(workspace_id) as { config_encrypted?: string } | undefined)?.config_encrypted);
    if (!existing_raw) throw new Error(`Workspace not found: ${workspace_id}`);
    const existing = normalize_workspace_record(existing_raw);
    const workspace_path = Object.prototype.hasOwnProperty.call(input, "workspace_path")
      ? normalize_agent_registry_workspace(input.workspace_path as string)
      : existing.workspace_path;
    const updated_at = new Date().toISOString();
    const record: WorkspaceRegistryRecord = {
      workspace_id,
      workspace_path,
      name: Object.prototype.hasOwnProperty.call(input, "name")
        ? normalize_workspace_name(input.name, workspace_path)
        : existing.name,
      created_at: existing.created_at,
      updated_at,
    };
    database.prepare(`
      UPDATE workspaces
      SET workspace_path = ?, config_encrypted = ?, updated_at = ?
      WHERE workspace_id = ?;
    `).run(workspace_path, encode_record(record), updated_at, workspace_id);
    return record;
  });
}

/** 删除 Workspace 注册记录；不会删除项目目录或 Session。 */
export function remove_workspace_registry_record(workspace_id_input: string): void {
  const workspace_id = normalize_workspace_registry_id(workspace_id_input);
  with_database((database) => {
    database.prepare("DELETE FROM workspaces WHERE workspace_id = ?;").run(workspace_id);
  });
}

/** 在已打开连接中按路径读取 Workspace。 */
function read_workspace_by_path(
  database: DatabaseSync,
  workspace_path: string,
): WorkspaceRegistryRecord | null {
  const record = decode_record<WorkspaceRegistryRecord>((database.prepare(
    "SELECT config_encrypted FROM workspaces WHERE workspace_path = ? LIMIT 1;",
  ).get(workspace_path) as { config_encrypted?: string } | undefined)?.config_encrypted);
  return record ? normalize_workspace_record(record) : null;
}

/** 解析 Workspace 展示名。 */
function normalize_workspace_name(value: unknown, workspace_path: string): string {
  return String(value || "").trim() || path.basename(workspace_path) || workspace_path;
}
