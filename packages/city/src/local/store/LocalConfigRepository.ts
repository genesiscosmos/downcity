/**
 * LocalCityStore Agent 与 Workspace 配置仓储。
 *
 * 仓储维护稳定配置和关系约束；数据库行、密文和时间戳不进入 Agent SDK。
 */

import crypto from "node:crypto";
import path from "node:path";
import type { JsonObject } from "@downcity/agent";
import type { CityPluginBindingConfig } from "@/types/CityAgentConfig.js";
import type { LocalAgentConfig, LocalWorkspaceConfig } from "@/local/types/LocalCity.js";
import type { LocalDatabase } from "@/local/store/LocalDatabase.js";
import type { LocalCrypto } from "@/local/store/LocalCrypto.js";

interface AgentRow {
  /** Agent ID。 */
  agent_id: string;
  /** Workspace ID。 */
  workspace_id: string | null;
  /** 加密配置。 */
  config_encrypted: string;
  /** 创建时间。 */
  created_at: string;
  /** 更新时间。 */
  updated_at: string;
}

interface WorkspaceRow {
  /** Workspace ID。 */
  workspace_id: string;
  /** Workspace 路径。 */
  workspace_path: string;
  /** 加密配置。 */
  config_encrypted: string;
  /** 创建时间。 */
  created_at: string;
  /** 更新时间。 */
  updated_at: string;
}

/** Agent 与 Workspace 配置仓储。 */
export class LocalConfigRepository {
  constructor(
    private readonly database: LocalDatabase,
    private readonly crypto_adapter: LocalCrypto,
  ) {
    this.migrate_legacy_cli_start();
  }

  /** 读取统一数据库中的加密设置。 */
  get_secure_setting<T>(key_input: string): T | null {
    const key = String(key_input || "").trim();
    if (!key) throw new Error("secure setting key is required");
    const row = this.database.sqlite.prepare(`
      SELECT value_encrypted FROM platform_secure_settings WHERE key = ? LIMIT 1;
    `).get(key) as { value_encrypted?: string } | undefined;
    if (!row?.value_encrypted) return null;
    return JSON.parse(this.crypto_adapter.decrypt(row.value_encrypted)) as T;
  }

  /** 写入统一数据库中的加密设置。 */
  set_secure_setting(key_input: string, value: unknown): void {
    const key = String(key_input || "").trim();
    if (!key) throw new Error("secure setting key is required");
    const current_time = new Date().toISOString();
    this.database.sqlite.prepare(`
      INSERT INTO platform_secure_settings (key, value_encrypted, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_encrypted = excluded.value_encrypted,
        updated_at = excluded.updated_at;
    `).run(
      key,
      this.crypto_adapter.encrypt(JSON.stringify(value ?? null)),
      current_time,
      current_time,
    );
  }

  /** 列出全部已绑定 Workspace 的 Agent 配置。 */
  list_agents(): LocalAgentConfig[] {
    const rows = this.database.sqlite.prepare(`
      SELECT agent_id, workspace_id, config_encrypted, created_at, updated_at
      FROM managed_agents ORDER BY agent_id ASC;
    `).all() as unknown as AgentRow[];
    return rows.map((row) => this.decode_agent(row));
  }

  /** 创建一个可暂时未绑定 Workspace 的 Agent 配置。 */
  create_agent(input: {
    /** Agent ID。 */
    agent_id: string;
    /** 配置版本。 */
    version?: string;
    /** 执行配置。 */
    execution?: JsonObject;
    /** LLM 配置。 */
    llm?: JsonObject;
  }): LocalAgentConfig {
    const agent_id = normalize_agent_id(input.agent_id);
    if (this.get_agent(agent_id)) throw new Error(`Agent already exists: ${agent_id}`);
    const current_time = new Date().toISOString();
    const config = {
      version: String(input.version || "1.0.0"),
      ...(input.execution ? { execution: input.execution } : {}),
      ...(input.llm ? { llm: input.llm } : {}),
    };
    this.database.sqlite.prepare(`
      INSERT INTO managed_agents (
        agent_id, workspace_id, config_encrypted, created_at, updated_at
      ) VALUES (?, NULL, ?, ?, ?);
    `).run(
      agent_id,
      this.crypto_adapter.encrypt(JSON.stringify(config)),
      current_time,
      current_time,
    );
    return this.get_agent(agent_id)!;
  }

  /** 保存一个允许暂时未绑定 Workspace 的 Agent 管理配置。 */
  save_agent_config(input: LocalAgentConfig): LocalAgentConfig {
    const existing = this.get_agent(input.agent_id);
    if (!existing) return this.create_agent(input);
    const current_time = new Date().toISOString();
    const config = {
      version: input.version,
      ...(input.execution ? { execution: input.execution } : {}),
      ...(input.llm ? { llm: input.llm } : {}),
    };
    this.database.sqlite.prepare(`
      UPDATE managed_agents
      SET workspace_id = ?, config_encrypted = ?, updated_at = ?
      WHERE agent_id = ?;
    `).run(
      input.workspace_id ?? existing.workspace_id ?? null,
      this.crypto_adapter.encrypt(JSON.stringify(config)),
      current_time,
      input.agent_id,
    );
    return this.get_agent(input.agent_id)!;
  }

  /** 按 ID 读取 Agent 配置。 */
  get_agent(agent_id_input: string): LocalAgentConfig | null {
    const agent_id = normalize_agent_id(agent_id_input);
    const row = this.database.sqlite.prepare(`
      SELECT agent_id, workspace_id, config_encrypted, created_at, updated_at
      FROM managed_agents WHERE agent_id = ? LIMIT 1;
    `).get(agent_id) as AgentRow | undefined;
    return row ? this.decode_agent(row) : null;
  }

  /** 更新 Agent 与 Workspace 的稳定绑定。 */
  bind_agent_workspace(agent_id_input: string, workspace_id_input: string): void {
    const agent_id = normalize_agent_id(agent_id_input);
    const workspace_id = normalize_workspace_id(workspace_id_input);
    if (!this.get_workspace(workspace_id)) throw new Error(`Workspace not found: ${workspace_id}`);
    const result = this.database.sqlite.prepare(`
      UPDATE managed_agents SET workspace_id = ?, updated_at = ? WHERE agent_id = ?;
    `).run(workspace_id, new Date().toISOString(), agent_id);
    if (Number(result.changes) === 0) throw new Error(`Agent not found: ${agent_id}`);
  }

  /** 删除 Agent 及其 Agent 级关联配置。 */
  remove_agent(agent_id_input: string): void {
    const agent_id = normalize_agent_id(agent_id_input);
    this.database.sqlite.exec("BEGIN IMMEDIATE;");
    try {
      for (const table_name of ["agent_tokens", "agent_plugins"]) {
        if (this.table_exists(table_name)) {
          this.database.sqlite.prepare(`DELETE FROM ${table_name} WHERE agent_id = ?;`).run(agent_id);
        }
      }
      this.database.sqlite.prepare("DELETE FROM managed_agents WHERE agent_id = ?;").run(agent_id);
      this.database.sqlite.exec("COMMIT;");
    } catch (error) {
      this.database.sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  /** 创建或读取同一路径 Workspace。 */
  ensure_workspace(input: {
    /** 可选稳定 ID。 */
    workspace_id?: string;
    /** 本地目录。 */
    workspace_path: string;
    /** 可选展示名称。 */
    name?: string;
  }): LocalWorkspaceConfig {
    const workspace_path = path.resolve(String(input.workspace_path || "").trim());
    if (!workspace_path) throw new Error("workspace_path is required");
    const existing = this.get_workspace_by_path(workspace_path);
    if (existing) return existing;
    const workspace_id = input.workspace_id
      ? normalize_workspace_id(input.workspace_id)
      : `workspace_${crypto.randomUUID().replaceAll("-", "")}`;
    const current_time = new Date().toISOString();
    const config = {
      workspace_id,
      workspace_path,
      name: String(input.name || "").trim() || path.basename(workspace_path) || workspace_id,
      created_at: current_time,
      updated_at: current_time,
    };
    this.database.sqlite.prepare(`
      INSERT INTO workspaces (
        workspace_id, workspace_path, config_encrypted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?);
    `).run(
      workspace_id,
      workspace_path,
      this.crypto_adapter.encrypt(JSON.stringify(config)),
      current_time,
      current_time,
    );
    return config;
  }

  /** 列出全部 Workspace。 */
  list_workspaces(): LocalWorkspaceConfig[] {
    const rows = this.database.sqlite.prepare(`
      SELECT workspace_id, workspace_path, config_encrypted, created_at, updated_at
      FROM workspaces ORDER BY workspace_id ASC;
    `).all() as unknown as WorkspaceRow[];
    return rows.map((row) => this.decode_workspace(row));
  }

  /** 按 ID 读取 Workspace。 */
  get_workspace(workspace_id_input: string): LocalWorkspaceConfig | null {
    const workspace_id = normalize_workspace_id(workspace_id_input);
    const row = this.database.sqlite.prepare(`
      SELECT workspace_id, workspace_path, config_encrypted, created_at, updated_at
      FROM workspaces WHERE workspace_id = ? LIMIT 1;
    `).get(workspace_id) as WorkspaceRow | undefined;
    return row ? this.decode_workspace(row) : null;
  }

  /** 按路径读取 Workspace。 */
  get_workspace_by_path(workspace_path_input: string): LocalWorkspaceConfig | null {
    const workspace_path = path.resolve(String(workspace_path_input || "").trim());
    const row = this.database.sqlite.prepare(`
      SELECT workspace_id, workspace_path, config_encrypted, created_at, updated_at
      FROM workspaces WHERE workspace_path = ? LIMIT 1;
    `).get(workspace_path) as WorkspaceRow | undefined;
    return row ? this.decode_workspace(row) : null;
  }

  /** 读取指定 Agent 的全部 Plugin 绑定。 */
  list_plugins(agent_id: string): CityPluginBindingConfig[] {
    const rows = this.database.sqlite.prepare(`
      SELECT plugin_name, enabled, config_encrypted, resource_ids_json
      FROM agent_plugins WHERE agent_id = ? ORDER BY plugin_name ASC;
    `).all(agent_id) as Array<{
      /** Plugin 名称。 */
      plugin_name: string;
      /** 启用状态。 */
      enabled: number;
      /** 加密配置。 */
      config_encrypted: string;
      /** Resource ID JSON。 */
      resource_ids_json: string;
    }>;
    return rows.map((row) => ({
      plugin_name: row.plugin_name,
      enabled: row.enabled === 1,
      config: JSON.parse(this.crypto_adapter.decrypt(row.config_encrypted)) as JsonObject,
      resource_ids: parse_string_array(row.resource_ids_json),
    }));
  }

  /** 把 Agent 行恢复为管理视图。 */
  private decode_agent(row: AgentRow): LocalAgentConfig {
    const raw = JSON.parse(this.crypto_adapter.decrypt(row.config_encrypted)) as Record<string, unknown>;
    return {
      agent_id: row.agent_id,
      ...(row.workspace_id ? { workspace_id: row.workspace_id } : {}),
      version: String(raw.version || "1.0.0"),
      ...(is_json_object(raw.execution) ? { execution: raw.execution } : {}),
      ...(is_json_object(raw.llm) ? { llm: raw.llm } : {}),
      plugins: this.list_plugins(row.agent_id),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /** 把 Workspace 行恢复为管理视图。 */
  private decode_workspace(row: WorkspaceRow): LocalWorkspaceConfig {
    const raw = JSON.parse(this.crypto_adapter.decrypt(row.config_encrypted)) as Record<string, unknown>;
    return {
      workspace_id: row.workspace_id,
      workspace_path: path.resolve(row.workspace_path),
      name: String(raw.name || "").trim() || path.basename(row.workspace_path),
      created_at: String(raw.created_at || row.created_at),
      updated_at: String(raw.updated_at || row.updated_at),
    };
  }

  /** 判断兼容表是否存在。 */
  private table_exists(table_name: string): boolean {
    return Boolean(this.database.sqlite.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1;
    `).get(table_name));
  }

  /** 把旧 Agent JSON 中的 CLI start 配置迁移到 CLI 专属 secure setting。 */
  private migrate_legacy_cli_start(): void {
    const rows = this.database.sqlite.prepare(`
      SELECT agent_id, config_encrypted FROM managed_agents ORDER BY agent_id ASC;
    `).all() as Array<{ agent_id: string; config_encrypted: string }>;
    for (const row of rows) {
      const raw = JSON.parse(this.crypto_adapter.decrypt(row.config_encrypted)) as Record<string, unknown>;
      if (!is_json_object(raw.start)) continue;
      const key = `cli.agent_start:${row.agent_id}`;
      if (!this.get_secure_setting(key)) this.set_secure_setting(key, normalize_start(raw.start));
      delete raw.start;
      this.database.sqlite.prepare(`
        UPDATE managed_agents SET config_encrypted = ? WHERE agent_id = ?;
      `).run(this.crypto_adapter.encrypt(JSON.stringify(raw)), row.agent_id);
    }
  }
}

/** 规范化 Agent ID。 */
export function normalize_agent_id(input: string): string {
  const agent_id = String(input || "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .replace(/_{2,}/gu, "_");
  if (!agent_id) throw new Error("agent_id is required");
  return agent_id;
}

/** 规范化 Workspace ID。 */
export function normalize_workspace_id(input: string): string {
  const workspace_id = String(input || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(workspace_id)) {
    throw new Error(`Invalid workspace_id: ${input}`);
  }
  return workspace_id;
}

/** 判断未知值是普通 JSON object。 */
function is_json_object(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** 读取唯一非空字符串数组。 */
function parse_string_array(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? [...new Set(parsed.map((item) => String(item || "").trim()).filter(Boolean))]
      : [];
  } catch {
    return [];
  }
}

/** 规范化 CLI 启动配置。 */
function normalize_start(value: JsonObject): { host?: string; port?: number } {
  const host = typeof value.host === "string" ? value.host.trim() : "";
  const port = typeof value.port === "number" && Number.isInteger(value.port)
    ? value.port
    : undefined;
  return {
    ...(host ? { host } : {}),
    ...(port !== undefined ? { port } : {}),
  };
}
