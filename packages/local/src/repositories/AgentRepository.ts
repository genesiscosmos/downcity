/**
 * 本地 Agent 配置仓储。
 *
 * 仓储维护稳定配置和关系约束；数据库行、密文和时间戳不进入 Agent SDK。
 */

import type { JsonObject } from "@downcity/agent";
import type {
  LocalAgentConfig,
  LocalAgentPluginConfig,
} from "@/types/LocalConfig.js";
import type { LocalDatabase } from "@/database/LocalDatabase.js";
import type { LocalCrypto } from "@/database/LocalCrypto.js";
import type { WorkspaceRepository } from "@/repositories/WorkspaceRepository.js";

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

/** 管理 Agent 配置及其 Workspace 绑定。 */
export class AgentRepository {
  constructor(
    private readonly database: LocalDatabase,
    private readonly crypto_adapter: LocalCrypto,
    private readonly workspaces: WorkspaceRepository,
  ) {}

  /** 列出全部已绑定 Workspace 的 Agent 配置。 */
  list(): LocalAgentConfig[] {
    const rows = this.database.prepare(`
      SELECT agent_id, workspace_id, config_encrypted, created_at, updated_at
      FROM managed_agents ORDER BY agent_id ASC;
    `).all() as unknown as AgentRow[];
    return rows.map((row) => this.decode_agent(row));
  }

  /** 创建一个已经绑定 Workspace 的完整 Agent 配置。 */
  create(input: {
    /** Agent ID。 */
    agent_id: string;
    /** Agent 对应的 Workspace ID。 */
    workspace_id: string;
    /** 配置版本。 */
    version?: string;
    /** 执行配置。 */
    execution?: JsonObject;
    /** LLM 配置。 */
    llm?: JsonObject;
  }): LocalAgentConfig {
    const agent_id = normalize_agent_id(input.agent_id);
    if (this.get(agent_id)) throw new Error(`Agent already exists: ${agent_id}`);
    const workspace = this.workspaces.get(input.workspace_id);
    if (!workspace) throw new Error(`Workspace not found: ${input.workspace_id}`);
    const current_time = new Date().toISOString();
    const config = {
      version: String(input.version || "1.0.0"),
      ...(input.execution ? { execution: input.execution } : {}),
      ...(input.llm ? { llm: input.llm } : {}),
    };
    this.database.prepare(`
      INSERT INTO managed_agents (
        agent_id, workspace_id, config_encrypted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?);
    `).run(
      agent_id,
      workspace.workspace_id,
      this.crypto_adapter.encrypt(JSON.stringify(config)),
      current_time,
      current_time,
    );
    return this.get(agent_id)!;
  }

  /** 保存 Agent 配置及其已有 Workspace 关系。 */
  save(input: LocalAgentConfig): LocalAgentConfig {
    const existing = this.get(input.agent_id);
    if (!existing) {
      if (!input.workspace_id) throw new Error("workspace_id is required");
      return this.create({
        agent_id: input.agent_id,
        workspace_id: input.workspace_id,
        version: input.version,
        execution: input.execution,
        llm: input.llm,
      });
    }
    const current_time = new Date().toISOString();
    const config = {
      version: input.version,
      ...(input.execution ? { execution: input.execution } : {}),
      ...(input.llm ? { llm: input.llm } : {}),
    };
    this.database.prepare(`
      UPDATE managed_agents
      SET workspace_id = ?, config_encrypted = ?, updated_at = ?
      WHERE agent_id = ?;
    `).run(
      input.workspace_id ?? existing.workspace_id ?? null,
      this.crypto_adapter.encrypt(JSON.stringify(config)),
      current_time,
      input.agent_id,
    );
    return this.get(input.agent_id)!;
  }

  /** 按 ID 读取 Agent 配置。 */
  get(agent_id_input: string): LocalAgentConfig | null {
    const agent_id = normalize_agent_id(agent_id_input);
    const row = this.database.prepare(`
      SELECT agent_id, workspace_id, config_encrypted, created_at, updated_at
      FROM managed_agents WHERE agent_id = ? LIMIT 1;
    `).get(agent_id) as AgentRow | undefined;
    return row ? this.decode_agent(row) : null;
  }

  /** 删除 Agent 及其 Agent 级关联配置。 */
  remove(agent_id_input: string): void {
    const agent_id = normalize_agent_id(agent_id_input);
    this.database.transaction(() => {
      this.database.prepare("DELETE FROM agent_plugins WHERE agent_id = ?;").run(agent_id);
      this.database.prepare("DELETE FROM managed_agents WHERE agent_id = ?;").run(agent_id);
    });
  }

  /** 读取指定 Agent 的全部 Plugin 绑定。 */
  list_plugins(agent_id: string): LocalAgentPluginConfig[] {
    const rows = this.database.prepare(`
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
