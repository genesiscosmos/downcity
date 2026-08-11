/**
 * Downcity Agent Registry 共享仓储。
 *
 * 该模块是 CLI 与桌面客户端共同使用的唯一 Agent 注册事实源；它只负责
 * 用户级 SQLite 中的 Agent 身份和 Workspace 绑定，不负责 Agent 运行时。
 */

import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type {
  AgentRegistryRecord,
  CreateAgentRegistryInput,
  UpdateAgentRegistryInput,
} from "./types/AgentRegistry.js";

export type {
  AgentRegistryRecord,
  CreateAgentRegistryInput,
  UpdateAgentRegistryInput,
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
  const agent_id = String(input || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/_{2,}/g, "_");
  if (!agent_id) throw new Error("agent_id is required");
  return agent_id;
}

/** 规范化 Workspace 绝对路径。 */
export function normalize_agent_registry_workspace(input: string): string {
  const workspace_path = path.resolve(String(input || "").trim() || ".");
  if (!workspace_path) throw new Error("workspace_path is required");
  return workspace_path;
}

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

function encode_record(record: AgentRegistryRecord): string {
  const key = get_key();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(record), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

function decode_record(value: unknown): AgentRegistryRecord | null {
  if (typeof value !== "string" || !value) return null;
  const packed = Buffer.from(value, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", get_key(), packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8")) as AgentRegistryRecord;
}

function with_database<T>(callback: (database: DatabaseSync) => T): T {
  const db_path = get_agent_registry_db_path();
  fs.mkdirSync(path.dirname(db_path), { recursive: true });
  const database = new DatabaseSync(db_path);
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("CREATE TABLE IF NOT EXISTS managed_agents (agent_id TEXT PRIMARY KEY NOT NULL, workspace_path TEXT NOT NULL, config_encrypted TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);");
  database.exec("CREATE INDEX IF NOT EXISTS managed_agents_workspace_path_idx ON managed_agents(workspace_path);");
  try { return callback(database); } finally { database.close(); }
}

/** 列出全部已注册 Agent。 */
export function list_agent_registry_records(): AgentRegistryRecord[] {
  return with_database((database) => (database.prepare("SELECT config_encrypted FROM managed_agents ORDER BY agent_id ASC;").all() as Array<{ config_encrypted: string }>).map((row) => decode_record(row.config_encrypted)).filter((record): record is AgentRegistryRecord => record !== null));
}

/** 创建并持久化 Agent 注册记录。 */
export function create_agent_registry_record(input: CreateAgentRegistryInput): AgentRegistryRecord {
  const agent_id = normalize_agent_registry_id(input.agent_id);
  const workspace_path = normalize_agent_registry_workspace(input.workspace_path);
  return with_database((database) => {
    if (database.prepare("SELECT 1 FROM managed_agents WHERE agent_id = ? LIMIT 1;").get(agent_id)) throw new Error(`Agent already exists: ${agent_id}`);
    const current_time = new Date().toISOString();
    const record = { ...input, agent_id, workspace_path, version: String(input.version || "1.0.0"), created_at: current_time, updated_at: current_time };
    database.prepare("INSERT INTO managed_agents (agent_id, workspace_path, config_encrypted, created_at, updated_at) VALUES (?, ?, ?, ?, ?);").run(agent_id, workspace_path, encode_record(record), current_time, current_time);
    return record;
  });
}

/** 按 ID 读取 Agent。 */
export function get_agent_registry_record(agent_id_input: string): AgentRegistryRecord | null {
  const agent_id = normalize_agent_registry_id(agent_id_input);
  return with_database((database) => decode_record((database.prepare("SELECT config_encrypted FROM managed_agents WHERE agent_id = ? LIMIT 1;").get(agent_id) as { config_encrypted?: string } | undefined)?.config_encrypted));
}

/** 按 Workspace 路径列出全部 Agent。 */
export function list_agent_registry_records_by_workspace(workspace_input: string): AgentRegistryRecord[] {
  const workspace_path = normalize_agent_registry_workspace(workspace_input);
  return with_database((database) => (database.prepare("SELECT config_encrypted FROM managed_agents WHERE workspace_path = ? ORDER BY agent_id ASC;").all(workspace_path) as Array<{ config_encrypted: string }>).map((row) => decode_record(row.config_encrypted)).filter((record): record is AgentRegistryRecord => record !== null));
}

/** 更新现有 Agent 注册记录。 */
export function update_agent_registry_record(input: UpdateAgentRegistryInput): AgentRegistryRecord {
  const existing = get_agent_registry_record(input.agent_id);
  if (!existing) throw new Error(`Agent not found: ${input.agent_id}`);
  const record: AgentRegistryRecord = {
    ...existing,
    ...(Object.prototype.hasOwnProperty.call(input, "workspace_path") ? { workspace_path: normalize_agent_registry_workspace(input.workspace_path as string) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "start") ? { start: input.start } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "execution") ? { execution: input.execution } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "llm") ? { llm: input.llm } : {}),
    updated_at: new Date().toISOString(),
  };
  return save_agent_registry_record(record);
}

/** 保存完整 Agent 注册记录，并保留原创建时间。 */
export function save_agent_registry_record(input: AgentRegistryRecord): AgentRegistryRecord {
  const agent_id = normalize_agent_registry_id(input.agent_id);
  const workspace_path = normalize_agent_registry_workspace(input.workspace_path);
  return with_database((database) => {
    const previous = decode_record((database.prepare("SELECT config_encrypted FROM managed_agents WHERE agent_id = ? LIMIT 1;").get(agent_id) as { config_encrypted?: string } | undefined)?.config_encrypted);
    if (!previous) throw new Error(`Agent not found: ${agent_id}`);
    const record = { ...input, agent_id, workspace_path, created_at: previous.created_at, updated_at: new Date().toISOString() };
    database.prepare("UPDATE managed_agents SET workspace_path = ?, config_encrypted = ?, updated_at = ? WHERE agent_id = ?;").run(workspace_path, encode_record(record), record.updated_at, agent_id);
    return record;
  });
}

/** 删除 Agent 注册记录。 */
export function remove_agent_registry_record(agent_id_input: string): void {
  const agent_id = normalize_agent_registry_id(agent_id_input);
  with_database((database) => {
    database.exec("BEGIN IMMEDIATE;");
    try {
      for (const table_name of ["agent_tokens", "agent_plugins"]) {
        const exists = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1;").get(table_name);
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
