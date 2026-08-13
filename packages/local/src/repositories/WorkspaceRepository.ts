/** 本地 Workspace 配置仓储。 */

import crypto from "node:crypto";
import path from "node:path";
import type { LocalCrypto } from "@/database/LocalCrypto.js";
import type { LocalDatabase } from "@/database/LocalDatabase.js";
import type { LocalWorkspaceConfig } from "@/types/LocalConfig.js";

/** Workspace 数据库行。 */
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

/** 管理 Workspace 配置和路径唯一性。 */
export class WorkspaceRepository {
  constructor(
    private readonly database: LocalDatabase,
    private readonly crypto_adapter: LocalCrypto,
  ) {}

  /** 创建或读取同一路径 Workspace。 */
  ensure(input: {
    /** 可选稳定 ID。 */
    workspace_id?: string;
    /** 本地目录。 */
    workspace_path: string;
    /** 可选展示名称。 */
    name?: string;
  }): LocalWorkspaceConfig {
    const workspace_path = path.resolve(String(input.workspace_path || "").trim());
    if (!workspace_path) throw new Error("workspace_path is required");
    const existing = this.get_by_path(workspace_path);
    if (existing) return existing;
    const workspace_id = input.workspace_id
      ? normalize_workspace_id(input.workspace_id)
      : `workspace_${crypto.randomUUID().replaceAll("-", "")}`;
    const current_time = new Date().toISOString();
    const config: LocalWorkspaceConfig = {
      workspace_id,
      workspace_path,
      name: String(input.name || "").trim() || path.basename(workspace_path) || workspace_id,
      created_at: current_time,
      updated_at: current_time,
    };
    this.database.prepare(`
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
  list(): LocalWorkspaceConfig[] {
    const rows = this.database.prepare(`
      SELECT workspace_id, workspace_path, config_encrypted, created_at, updated_at
      FROM workspaces ORDER BY workspace_id ASC;
    `).all() as unknown as WorkspaceRow[];
    return rows.map((row) => this.decode(row));
  }

  /** 按 ID 读取 Workspace。 */
  get(workspace_id_input: string): LocalWorkspaceConfig | null {
    const workspace_id = normalize_workspace_id(workspace_id_input);
    const row = this.database.prepare(`
      SELECT workspace_id, workspace_path, config_encrypted, created_at, updated_at
      FROM workspaces WHERE workspace_id = ? LIMIT 1;
    `).get(workspace_id) as WorkspaceRow | undefined;
    return row ? this.decode(row) : null;
  }

  /** 按绝对路径读取 Workspace。 */
  get_by_path(workspace_path_input: string): LocalWorkspaceConfig | null {
    const workspace_path = path.resolve(String(workspace_path_input || "").trim());
    const row = this.database.prepare(`
      SELECT workspace_id, workspace_path, config_encrypted, created_at, updated_at
      FROM workspaces WHERE workspace_path = ? LIMIT 1;
    `).get(workspace_path) as WorkspaceRow | undefined;
    return row ? this.decode(row) : null;
  }

  /** 解密 Workspace 数据库行。 */
  private decode(row: WorkspaceRow): LocalWorkspaceConfig {
    const raw = JSON.parse(this.crypto_adapter.decrypt(row.config_encrypted)) as Record<string, unknown>;
    return {
      workspace_id: row.workspace_id,
      workspace_path: path.resolve(row.workspace_path),
      name: String(raw.name || "").trim() || path.basename(row.workspace_path),
      created_at: String(raw.created_at || row.created_at),
      updated_at: String(raw.updated_at || row.updated_at),
    };
  }
}

/** 规范化 Workspace ID。 */
export function normalize_workspace_id(input: string): string {
  const workspace_id = String(input || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(workspace_id)) {
    throw new Error(`Invalid workspace_id: ${input}`);
  }
  return workspace_id;
}
